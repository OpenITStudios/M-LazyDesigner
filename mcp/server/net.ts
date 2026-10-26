import type { IncomingMessage, Server as NodeHttpServer, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import {
  RUNTIME_AUTH_HEADER,
  isRuntimeAuthorizationToken,
  runtimeAuthorizationMatches
} from '@/lib/runtime/authorization'
import {
  MAX_REQUEST_BODY_BYTES,
  MAX_REQUEST_HEADER_BYTES,
  RuntimePayloadTooLargeError,
  SOCKET_IDLE_TIMEOUT_MS,
  isAllowedLocalHost,
  isAllowedLocalOrigin,
  jsonErrorBody,
  rawHeaderCount,
  readNodeRequestBody,
  sendNodeResponse,
  singleRequestHeader
} from '@/server/httpBoundary'
import { createProductIdentity } from '@/lib/product/productIdentity'
import { getCapabilityMetadata } from '@/lib/capabilities/metadata'
import {
  getActiveMcpAuthoringStage,
  type McpAuthoringStage
} from '@/lib/capabilities/authoringStage'
import {
  getActiveMcpRegistrationProfile,
  getMcpSurfaceToolNames
} from '@/server/tools'
import {
  BLOCKIT_AUTHORING_PHASE_AFFINITY_HEADER,
  BLOCKIT_PROJECT_AFFINITY_HEADER,
  normalizeProjectAffinityUuid,
  normalizeAuthoringPhaseAffinity
} from '@/lib/runtime/affinity'
import {
  RuntimeGenerationRetiredError,
  RuntimeOperationQueueFullError,
  RuntimeQueuedOperationAbandonedError,
  isRuntimeGenerationCurrent,
  runRuntimeOperationExclusive,
  waitForRuntimeOperationDrain
} from '@/lib/runtime/lifecycle'
import {
  RuntimeProjectContextError,
  getRuntimeProjectHealth,
  runWithRuntimeProjectAffinity
} from '@/server/projectAffinity'
import { runWithMcpStageRequest } from '@/server/runtime/phaseControl'
import {
  projectContextErrorBody,
  readRequestEnvelope,
  validateMcpRoutingHeaders
} from '@/server/requestProtocol'
import {
  handleStatelessMcpRequest,
  sendSerializedWebResponse
} from '@/server/mcpTransport'

const INSTANCE_ID = crypto.randomUUID()
const STARTUP_TIME = new Date().toISOString()

export function normalizeBuildIdentity (value: unknown): string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
    ? value
    : 'source'
}

const BUILD_IDENTITY = normalizeBuildIdentity(
  (globalThis as { __LAZYDESIGNER_BUILD_ID__?: unknown }).__LAZYDESIGNER_BUILD_ID__
)

export interface NetServer extends NodeHttpServer {
  closeActiveSockets(): void
  closeAndWait(): Promise<void>
}

class RuntimeRequestAbandonedError extends Error {
  constructor () {
    super('Queued Runtime tool request was abandoned before execution.')
    this.name = 'RuntimeRequestAbandonedError'
  }
}

export default function createNetServer (
  {
    createServer
  }: {
    createServer: (
      options: { maxHeaderSize: number },
      callback: (request: IncomingMessage, response: ServerResponse) => void
    ) => NodeHttpServer
  },
  {
    port,
    endpoint,
    host = '127.0.0.1',
    generation = null,
    authorizationToken = null
  }: {
    endpoint: string
    port: number
    host?: string
    generation?: number | null
    authorizationToken?: string | null
  }
): NetServer {
  // A real Blockbench listener always has a Runtime generation and MUST carry
  // a valid local credential. Isolated HTTP/protocol fixtures may omit both.
  if (generation !== null && !isRuntimeAuthorizationToken(authorizationToken)) {
    throw new Error('Native LazyDesigner Runtime requires a local authorization credential.')
  }
  if (authorizationToken !== null && !isRuntimeAuthorizationToken(authorizationToken)) {
    throw new Error('Invalid native Runtime authorization credential.')
  }
  const activeSockets = new Set<Socket>()
  let shuttingDown = false
  let closePromise: Promise<void> | null = null

  const httpServer = createServer(
    { maxHeaderSize: MAX_REQUEST_HEADER_BYTES },
    (request: IncomingMessage, response: ServerResponse) => {
      void (async () => {
        if (shuttingDown) {
          response.setHeader('connection', 'close')
          response.destroy()
          return
        }

        const method = request.method ?? ''
        const rawPath = request.url ?? endpoint
        const pathWithoutQuery = rawPath.split('?')[0]
        const hostHeader = request.headers.host
        const originHeader = request.headers.origin
        const connectionClose =
          request.headers.connection?.toLowerCase() === 'close'

        if (
          rawHeaderCount(request, 'host') > 1 ||
          rawHeaderCount(request, 'origin') > 1 || 
          rawHeaderCount(request, RUNTIME_AUTH_HEADER) > 1 ||
          rawHeaderCount(request, 'mcp-protocol-version') > 1 ||
          rawHeaderCount(request, 'mcp-method') > 1 ||
          rawHeaderCount(request, 'mcp-name') > 1 ||
          (request.httpVersion === '1.1' && hostHeader === undefined)
        ) {
          sendNodeResponse(
            response,
            400,
            { 'content-type': 'application/json' },
            jsonErrorBody('Bad Request: malformed or ambiguous HTTP headers'),
            true
          )
          return
        }

        if (request.headers['transfer-encoding'] !== undefined) {
          sendNodeResponse(
            response,
            400,
            { 'content-type': 'application/json' },
            jsonErrorBody(
              'Bad Request: Transfer-Encoding is not supported; send Content-Length.'
            ),
            true
          )
          return
        }

        const rawContentLength = request.headers['content-length']
        if (
          rawContentLength !== undefined &&
          (!/^\d+$/.test(rawContentLength) ||
            Number(rawContentLength) > MAX_REQUEST_BODY_BYTES)
        ) {
          const tooLarge =
            /^\d+$/.test(rawContentLength) &&
            Number(rawContentLength) > MAX_REQUEST_BODY_BYTES
          sendNodeResponse(
            response,
            tooLarge ? 413 : 400,
            { 'content-type': 'application/json' },
            tooLarge
              ? jsonErrorBody('Payload Too Large: request body exceeds limit')
              : jsonErrorBody('Bad Request: invalid Content-Length'),
            true
          )
          return
        }

        if (originHeader !== undefined && !isAllowedLocalOrigin(originHeader)) {
          sendNodeResponse(
            response,
            403,
            { 'content-type': 'application/json' },
            jsonErrorBody('Forbidden: invalid Origin header'),
            connectionClose
          )
          return
        }

        if (hostHeader !== undefined && !isAllowedLocalHost(hostHeader)) {
          sendNodeResponse(
            response,
            403,
            { 'content-type': 'application/json' },
            jsonErrorBody('Forbidden: invalid Host header'),
            connectionClose
          )
          return
        }

        // Do not reveal open-project health, catalog or mutation surfaces to
        // clients lacking the machine-local credential.
        if (
          authorizationToken !== null &&
          !runtimeAuthorizationMatches(
            authorizationToken,
            singleRequestHeader(request, RUNTIME_AUTH_HEADER)
          )
        ) {
          sendNodeResponse(
            response,
            401,
            { 'content-type': 'application/json' },
            jsonErrorBody('Unauthorized: invalid Runtime client credential'),
            true
          )
          return
        }

        let requestedProjectUuid: string | null
        try {
          requestedProjectUuid = normalizeProjectAffinityUuid(
            request.headers[BLOCKIT_PROJECT_AFFINITY_HEADER] as
              | string
              | undefined
          )
        } catch (error) {
          sendNodeResponse(
            response,
            400,
            { 'content-type': 'application/json' },
            projectContextErrorBody(
              null,
              error instanceof Error ? error.message : String(error)
            ),
            true
          )
          return
        }

        let requestedAuthoringPhase: McpAuthoringStage | null
        try {
          requestedAuthoringPhase = normalizeAuthoringPhaseAffinity(
            request.headers[BLOCKIT_AUTHORING_PHASE_AFFINITY_HEADER] as
              | string
              | undefined
          )
        } catch (error) {
          sendNodeResponse(
            response,
            400,
            { 'content-type': 'application/json' },
            jsonErrorBody(
              error instanceof Error ? error.message : String(error)
            ),
            true
          )
          return
        }

        const effectiveAuthoringPhase =
          requestedAuthoringPhase ?? getActiveMcpAuthoringStage()
        const activeProfile = getActiveMcpRegistrationProfile()

        if (
          pathWithoutQuery === '/health' ||
          pathWithoutQuery === endpoint + '/health'
        ) {
          sendNodeResponse(
            response,
            200,
            { 'content-type': 'application/json' },
            JSON.stringify({
              status: 'ok',
              timestamp: new Date().toISOString(),
              product: createProductIdentity(
                activeProfile,
                effectiveAuthoringPhase
              ),
              build_identity: BUILD_IDENTITY,
              instance_id: INSTANCE_ID,
              startup_time: STARTUP_TIME,
              exposed_tool_count: getMcpSurfaceToolNames(
                activeProfile,
                effectiveAuthoringPhase
              ).length,
              project_context: getRuntimeProjectHealth(requestedProjectUuid),
              transport: {
                mode: 'stateless',
                response_mode: 'auto'
              }
            }),
            connectionClose
          )
          return
        }

        if (
          pathWithoutQuery === '/ready' ||
          pathWithoutQuery === endpoint + '/ready'
        ) {
          sendNodeResponse(
            response,
            200,
            { 'content-type': 'application/json' },
            JSON.stringify({ ready: true }),
            connectionClose
          )
          return
        }

        if (
          pathWithoutQuery !== endpoint &&
          !rawPath.startsWith(endpoint + '/') &&
          !rawPath.startsWith(endpoint + '?')
        ) {
          sendNodeResponse(
            response,
            404,
            { 'content-type': 'text/plain' },
            'Not Found',
            connectionClose
          )
          return
        }

        if (method !== 'POST') {
          sendNodeResponse(
            response,
            405,
            {
              'content-type': 'application/json',
              allow: 'POST'
            },
            jsonErrorBody('Method not allowed in stateless MCP mode.'),
            connectionClose
          )
          return
        }

        let body: string
        try {
          body = await readNodeRequestBody(request)
        } catch (error) {
          if (error instanceof RuntimePayloadTooLargeError) {
            sendNodeResponse(
              response,
              413,
              { 'content-type': 'application/json' },
              jsonErrorBody('Payload Too Large: request body exceeds limit'),
              true
            )
            return
          }
          throw error
        }

        // readNodeRequestBody awaits network I/O. Shutdown or plugin reload
        // may retire this listener while that body is still arriving.
        // Refuse dispatch before constructing an MCP server or registering
        // a native operation against a retired generation.
        if (shuttingDown ||
            (generation !== null && !isRuntimeGenerationCurrent(generation))) {
          if (!response.destroyed && !response.writableEnded) {
            sendNodeResponse(
              response,
              503,
              { 'content-type': 'application/json' },
              jsonErrorBody('Runtime listener is shutting down; reconnect after reload'),
              true
            )
          }
          return
        }

        const requestUrl = new URL(
          rawPath,
          `${(request.socket as Socket & { encrypted?: boolean }).encrypted ? 'https' : 'http'}://${hostHeader ?? `${host}:${port}`}`
        )
        const webHeaders = new Headers()
        for (const [key, value] of Object.entries(request.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) webHeaders.append(key, item)
          } else if (value !== undefined) {
            webHeaders.set(key, value)
          }
        }
        const webRequest = new Request(requestUrl, {
          method,
          headers: webHeaders,
          body: body || undefined
        })
        const envelope = readRequestEnvelope(body)
        const routedMethodHeader = singleRequestHeader(request, 'mcp-method')
        const routedNameHeader = singleRequestHeader(request, 'mcp-name')

        const routingFailure = validateMcpRoutingHeaders(envelope, {
          protocolVersion: singleRequestHeader(request, 'mcp-protocol-version'),
          method: routedMethodHeader,
          name: routedNameHeader
        })
        if (routingFailure) {
          sendNodeResponse(
            response,
            400,
            { 'content-type': 'application/json' },
            jsonErrorBody(routingFailure.message, envelope.id, routingFailure.code),
            true
          )
          return
        }

        // Trust the parsed JSON-RPC body for all native routing decisions.
        const routedMethod = envelope.method
        const routedCapability = routedMethod === 'tools/call'
          ? envelope.capability
          : null
        const capabilityEffects = routedCapability
          ? getCapabilityMetadata(routedCapability).effects
          : null
        const needsProjectContext =
          routedMethod === 'tools/call' && requestedProjectUuid !== null
        const allowProjectTransition =
          capabilityEffects?.projectAffinity === 'adopt_created_project'

        const nativeRequestAbort = new AbortController()
        const onNativeRequestClosed = () => nativeRequestAbort.abort()
        if (routedMethod === 'tools/call') {
          request.once('aborted', onNativeRequestClosed)
          response.once('close', onNativeRequestClosed)
          if (request.aborted || response.destroyed || shuttingDown) {
            nativeRequestAbort.abort()
          }
        }
        try {
          const dispatch = async (
            executionPhase: McpAuthoringStage,
            executionProfile: ReturnType<typeof getActiveMcpRegistrationProfile>
          ) => {
            const execute = async () => await handleStatelessMcpRequest(
              webRequest,
              executionPhase,
              executionProfile,
              requestedAuthoringPhase !== null
            )
            return needsProjectContext
              ? await runWithRuntimeProjectAffinity(
                  requestedProjectUuid,
                  allowProjectTransition,
                  execute
                )
              : await execute()
          }
          const result = routedMethod === 'tools/call'
            ? await runRuntimeOperationExclusive(generation, async () => {
                if (
                  request.aborted ||
                  response.destroyed ||
                  shuttingDown
                ) {
                  throw new RuntimeRequestAbandonedError()
                }
                // A direct request can wait while a prior call switches the
                // Blockbench-global Stage/profile. Snapshot at execution,
                // never when the HTTP request first entered the queue.
                const executionPhase =
                  requestedAuthoringPhase ?? getActiveMcpAuthoringStage()
                const executionProfile = getActiveMcpRegistrationProfile()
                return await runWithMcpStageRequest(
                  executionPhase,
                  requestedAuthoringPhase !== null,
                  () => dispatch(executionPhase, executionProfile)
                )
              }, { signal: nativeRequestAbort.signal })
            : await dispatch(effectiveAuthoringPhase, activeProfile)

          // Even read-only MCP requests may finish after shutdown begins.
          // Do not publish a stale tools/list/initialize result from a retired
          // Runtime generation. Mutations already have the native generation
          // completion guard; no mutation is retried or replayed.
          if (shuttingDown ||
              (generation !== null && !isRuntimeGenerationCurrent(generation))) return

          // Finite JSON/JSON-RPC responses have Content-Length and may reuse
          // the client socket. Preserve explicit Connection: close, while
          // subscription streams retain their existing streaming lifecycle.
          const closeMcpConnection = connectionClose
          await sendSerializedWebResponse(
            response,
            result,
            closeMcpConnection
          )
        } catch (error) {
          if (error instanceof RuntimeOperationQueueFullError) {
            sendNodeResponse(
              response,
              429,
              { 'content-type': 'application/json', 'retry-after': '1' },
              jsonErrorBody(error.message, envelope.id),
              true
            )
            return
          }
          if (
            error instanceof RuntimeRequestAbandonedError ||
            error instanceof RuntimeQueuedOperationAbandonedError ||
            error instanceof RuntimeGenerationRetiredError
          ) return
          if (
            error instanceof RuntimeProjectContextError &&
            !error.outcomeUnknown
          ) {
            sendNodeResponse(
              response,
              409,
              { 'content-type': 'application/json' },
              projectContextErrorBody(envelope.id, error.message),
              true
            )
            return
          }

          console.error('[MCP] Request handler error:', error)
          sendNodeResponse(
            response,
            500,
            { 'content-type': 'application/json' },
            jsonErrorBody('Internal server error', null, -32603),
            true
          )
        } finally {
          if (routedMethod === 'tools/call') {
            request.off('aborted', onNativeRequestClosed)
            response.off('close', onNativeRequestClosed)
          }
        }
      })().catch((error) => {
        console.error('[MCP] Unhandled HTTP request error:', error)
        sendNodeResponse(
          response,
          500,
          { 'content-type': 'application/json' },
          jsonErrorBody('Internal server error', null, -32603),
          true
        )
      })
    }
  ) as NetServer

  // Keep a finite, idle-only socket reuse window. Active native MCP operations
  // may exceed this and are still protected by the separate operation budget.
  httpServer.keepAliveTimeout = 5_000

  httpServer.on('connection', (socket: Socket) => {
    if (shuttingDown) {
      socket.destroy()
      return
    }
    activeSockets.add(socket)
    socket.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
      socket.destroy()
    })
    socket.once('close', () => activeSockets.delete(socket))
  })

  httpServer.on('clientError', (error: Error & { code?: string }, socket: Socket) => {
    if (!socket.writable) return
    const status =
      error.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400
    const reason =
      status === 431
        ? 'Request Header Fields Too Large'
        : 'Bad Request'
    const body = jsonErrorBody(
      status === 431
        ? 'Bad Request: header section too large'
        : 'Bad Request: malformed HTTP request'
    )
    socket.end(
      `HTTP/1.1 ${status} ${reason}\r\n` +
        'Content-Type: application/json\r\n' +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        'Connection: close\r\n\r\n' +
        body
    )
  })

  httpServer.closeActiveSockets = () => {
    for (const socket of activeSockets) socket.destroy()
    activeSockets.clear()
  }

  httpServer.closeAndWait = () => {
    if (closePromise) return closePromise
    shuttingDown = true

    const listenerClosed = new Promise<void>((resolve, reject) => {
      httpServer.close((error?: Error) => {
        const code = (error as (Error & { code?: string }) | undefined)?.code
        if (error && code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
        else resolve()
      })
    })
    // Node's server.close callback can complete before native work has
    // drained (e.g. when no socket remains for an already-started operation).
    // A new Runtime generation must not bind until BOTH boundaries finish.
    const nativeDrained = waitForRuntimeOperationDrain().finally(() => {
      httpServer.closeActiveSockets()
    })
    closePromise = Promise.allSettled([listenerClosed, nativeDrained]).then(
      (outcomes) => {
        for (const outcome of outcomes) {
          if (outcome.status === 'rejected') throw outcome.reason
        }
      }
    )

    return closePromise
  }

  httpServer.listen(port, host, () => {
    console.log(`[MCP] Server listening on ${host}:${port}${endpoint}`)
  })

  httpServer.on('error', (error: Error) => {
    console.error('[MCP] Server error:', error)
    Blockbench.showQuickMessage(`MCP Server error: ${error.message}`, 3000)
  })

  return httpServer
}
