/// <reference types="three" />
/// <reference types="blockbench-types" />

import { z } from "zod";
import { recordCurrentCapabilitySemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import { finiteAnimationVector3Schema } from "./shared";

const bedrockParticleEffectSchema = z.object({
  effect: z
    .string()
    .min(1)
    .describe("Bedrock particle effect identifier."),
  locator: z
    .string()
    .min(1)
    .optional()
    .describe("Optional Locator name for the particle."),
  bind_to_actor: z
    .boolean()
    .optional()
    .describe(
      "Optional actor-binding flag."
    ),
  pre_effect_script: z
    .string()
    .optional()
    .describe("Optional pre-effect Molang script."),
});

const bedrockParticleEffectsSchema = z
  .record(
    z.string(),
    z.union([
      bedrockParticleEffectSchema,
      z.array(bedrockParticleEffectSchema).min(1),
    ])
  )
  .superRefine((particleEffects, ctx) => {
    const effectiveTimes = new Map<number, string>();

    Object.keys(particleEffects).forEach((timestamp) => {
      const normalizedTimestamp = timestamp.trim();
      const numericTime = Number(normalizedTimestamp);
      const codecTime = Number.parseFloat(normalizedTimestamp);

      if (
        normalizedTimestamp.length === 0 ||
        !Number.isFinite(numericTime) ||
        !Number.isFinite(codecTime) ||
        numericTime !== codecTime
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [timestamp],
          message: `Particle timestamp "${timestamp}" must be a complete finite numeric value.`,
        });
        return;
      }

      if (numericTime < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [timestamp],
          message: `Particle timestamp "${timestamp}" must be greater than or equal to 0.`,
        });
        return;
      }

      const previousTimestamp = effectiveTimes.get(numericTime);
      if (previousTimestamp !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [timestamp],
          message: `Particle timestamps "${previousTimestamp}" and "${timestamp}" resolve to the same effective time ${numericTime}. Use one timestamp per effective time.`,
        });
        return;
      }

      effectiveTimes.set(numericTime, timestamp);
    });
  })
  .describe(
    "Particle effects keyed by non-negative timestamps."
  );

const bedrockSoundEffectSchema = z.object({
  effect: z.string().min(1).describe("Bedrock sound effect ID."),
  locator: z.string().min(1).optional().describe("Optional sound Locator name."),
});

const bedrockSoundEffectsSchema = z
  .record(z.string(), z.union([bedrockSoundEffectSchema, z.array(bedrockSoundEffectSchema).min(1)]))
  .superRefine((soundEffects, ctx) => {
    const effectiveTimes = new Map<number, string>();
    Object.keys(soundEffects).forEach((timestamp) => {
      const normalizedTimestamp = timestamp.trim();
      const numericTime = Number(normalizedTimestamp);
      const codecTime = Number.parseFloat(normalizedTimestamp);
      if (
        normalizedTimestamp.length === 0 ||
        !Number.isFinite(numericTime) ||
        !Number.isFinite(codecTime) ||
        numericTime !== codecTime ||
        numericTime < 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [timestamp],
          message: `Sound timestamp "${timestamp}" must be a complete finite non-negative numeric value.`,
        });
        return;
      }
      const previousTimestamp = effectiveTimes.get(numericTime);
      if (previousTimestamp !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [timestamp],
          message: `Sound timestamps "${previousTimestamp}" and "${timestamp}" resolve to the same effective time ${numericTime}. Use one timestamp per effective time.`,
        });
        return;
      }
      effectiveTimes.set(numericTime, timestamp);
    });
  })
  .describe("Sound effects keyed by non-negative timestamps.");


const bedrockBoneKeyframeSchema = z.object({
  time: z
    .number()
    .finite()
    .min(0)
    .describe("Finite keyframe time in seconds (>=0)."),
  position: finiteAnimationVector3Schema
    .optional()
    .describe(
      "Authored Blockbench position [x,y,z]."
    ),
  rotation: finiteAnimationVector3Schema
    .optional()
    .describe(
      "Authored Blockbench rotation [x,y,z]."
    ),
  scale: z
    .union([finiteAnimationVector3Schema, z.number().finite()])
    .optional()
    .describe(
      "Scale [x,y,z] or uniform scalar."
    ),
});

const bedrockBoneKeyframesSchema = z
  .array(bedrockBoneKeyframeSchema)
  .superRefine((keyframes, ctx) => {
    const channelTimes = {
      position: new Map<number, number>(),
      rotation: new Map<number, number>(),
      scale: new Map<number, number>(),
    };
    const channels = ["position", "rotation", "scale"] as const;

    keyframes.forEach((keyframe, index) => {
      channels.forEach((channel) => {
        if (keyframe[channel] === undefined) return;

        const previousIndex = channelTimes[channel].get(keyframe.time);
        if (previousIndex !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "time"],
            message: `Bone keyframe entries ${previousIndex} and ${index} both define ${channel} at time ${keyframe.time}. Use one ${channel} value per effective time.`,
          });
          return;
        }

        channelTimes[channel].set(keyframe.time, index);
      });
    });
  })
  .describe(
    "Transform keyframes at non-negative times."
  );

export const createAnimationParameters = z.object({
  name: z.string().min(1).describe("Animation name."),
  loop: z
    .boolean()
    .default(false)
    .describe("Loop the animation."),
  animation_length: z
    .number()
    .finite()
    .min(0)
    .max(10000)
    .optional()
    .describe(
      "Optional animation length in seconds (0..10000)."
    ),
  bones: z
    .record(z.string(), bedrockBoneKeyframesSchema)
    .describe(
      "Bone keyframes keyed by Group UUID or case-insensitively unique name; values use authored space."
    ),
  particle_effects: bedrockParticleEffectsSchema.optional(),
  sound_effects: bedrockSoundEffectsSchema.optional(),
});


export const createAnimationToolDoc: ToolSpec = {
  name: "create_animation",
  description:
    "Creates one new authored Bedrock Animation clip with explicit bone transforms and optional initial sound/particle effects. Use this for a new clip, not project creation.",
  annotations: {
    title: "Create Bedrock Animation Clip",
    destructiveHint: true,
  },
  parameters: createAnimationParameters,
  status: STATUS_STABLE,
};

export function normalizeBedrockAnimationName(name: string): string {
  return name.startsWith("animation.") ? name : `animation.${name}`;
}

export function registerCreateAnimationTool(): void {
  createTool(
    createAnimationToolDoc.name,
    {
      ...createAnimationToolDoc,
      parameters: createAnimationParameters,
      async execute({ name, loop, animation_length, bones, particle_effects, sound_effects }) {
        if (!Project) {
          throw new Error(
            "No project is open. Open or create the intended Bedrock Entity project before creating an animation."
          );
        }
  
        type BedrockAnimationCodec = {
          id: string;
          loadFile?: (
            file: { content: string; path?: string },
            animationFilter?: string[]
          ) => BBAnimation[];
        };
        const animationCodecApi = (
          globalThis as typeof globalThis & {
            AnimationCodec?: {
              getCodec(animation?: BBAnimation): BedrockAnimationCodec | undefined;
            };
          }
        ).AnimationCodec;
        const codec = animationCodecApi?.getCodec();
        if (!codec || codec.id !== "bedrock" || typeof codec.loadFile !== "function") {
          throw new Error(
            "create_animation requires the current Bedrock AnimationCodec. Open a Bedrock Entity project before creating an animation."
          );
        }
  
        const seenGroupReferences = new Map<string, string>();
        const resolvedBoneEntries = Object.entries(bones).map(
          ([boneReference, keyframes]) => {
            const uuidMatch = Group.all.find(
              (group: Group) => group.uuid === boneReference
            );
            let group: Group;
  
            if (uuidMatch) {
              group = uuidMatch;
            } else {
              const normalizedReference = boneReference.toLowerCase();
              const nameMatches = Group.all.filter(
                (candidate: Group) =>
                  candidate.name.toLowerCase() === normalizedReference
              );
              if (nameMatches.length === 1) {
                group = nameMatches[0];
              } else if (nameMatches.length > 1) {
                throw new Error(
                  `Group name "${boneReference}" is ambiguous under Bedrock animation matching. Rename colliding Groups or target one after names are unique. Candidates: ${nameMatches
                    .map((candidate: Group) => `${candidate.name} (${candidate.uuid})`)
                    .join(", ")}`
                );
              } else {
                throw new Error(
                  `Group "${boneReference}" not found. Every create_animation bone must target an existing Group UUID or unique Group name.`
                );
              }
            }
  
            const codecNameMatches = Group.all.filter(
              (candidate: Group) =>
                candidate.name.toLowerCase() === group.name.toLowerCase()
            );
            if (
              codecNameMatches.length !== 1 ||
              codecNameMatches[0].uuid !== group.uuid
            ) {
              throw new Error(
                `Group "${group.name}" (${group.uuid}) cannot be targeted deterministically by create_animation because Bedrock animation import matches bone names case-insensitively. Rename colliding Groups first. Candidates: ${codecNameMatches
                  .map((candidate: Group) => `${candidate.name} (${candidate.uuid})`)
                  .join(", ")}`
              );
            }
  
            const previousReference = seenGroupReferences.get(group.uuid);
            if (previousReference !== undefined) {
              throw new Error(
                `create_animation bones "${previousReference}" and "${boneReference}" resolve to the same Group "${group.name}" (${group.uuid}). Provide each Group only once.`
              );
            }
            seenGroupReferences.set(group.uuid, boneReference);
  
            return {
              requestedReference: boneReference,
              group,
              keyframes,
            };
          }
        );
  
        const animationData = {
          loop,
          ...(animation_length !== undefined && { animation_length }),
          bones: Object.fromEntries(
            resolvedBoneEntries.map(({ group, keyframes }) => {
              const boneData: Record<
                string,
                Record<string, number | number[]>
              > = keyframes.reduce((acc, keyframe) => {
                const timeKey = keyframe.time.toString();
                if (keyframe.position) {
                  const [x, y, z] = keyframe.position;
                  (acc.position ??= {})[timeKey] = [-x, y, z];
                }
                if (keyframe.rotation) {
                  const [x, y, z] = keyframe.rotation;
                  (acc.rotation ??= {})[timeKey] = [-x, -y, z];
                }
                if (keyframe.scale !== undefined) {
                  (acc.scale ??= {})[timeKey] = keyframe.scale;
                }
                return acc;
              }, {} as Record<string, Record<string, number | number[]>>);
  
              return [group.name, boneData];
            })
          ),
          ...(particle_effects && { particle_effects }),
          ...(sound_effects && { sound_effects }),
        };
  
        const requestedAnimationName = normalizeBedrockAnimationName(name);
        const fileContent = JSON.stringify({
          format_version: "1.8.0",
          animations: {
            [requestedAnimationName]: animationData,
          },
        });
        const animationUuidsBefore = new Set(
          AnimationItem.all.map((animation) => animation.uuid)
        );
        let editStarted = false;
  
        try {
          Undo.initEdit({ animations: [] });
          editStarted = true;
  
          const codecCreatedAnimations = codec.loadFile(
            { content: fileContent },
            [requestedAnimationName]
          );
          const createdAnimations = codecCreatedAnimations.filter(
            (animation) =>
              !animationUuidsBefore.has(animation.uuid) &&
              AnimationItem.all.includes(animation)
          );
          if (createdAnimations.length !== 1) {
            throw new Error(
              `Bedrock AnimationCodec created ${createdAnimations.length} new animations; expected exactly 1.`
            );
          }
  
          const [createdAnimation] = createdAnimations;
          resolvedBoneEntries.forEach(({ requestedReference, group }) => {
            const animator = createdAnimation.animators[group.uuid];
            if (!(animator instanceof BoneAnimator)) {
              throw new Error(
                `Created animation "${createdAnimation.name}" did not bind requested bone "${requestedReference}" to Group "${group.name}" (${group.uuid}).`
              );
            }
          });
  
          createdAnimation.select();
          if (AnimationItem.selected !== createdAnimation) {
            throw new Error(
              `Created animation "${createdAnimation.name}" could not be selected for timeline operations.`
            );
          }
  
          Undo.finishEdit("Create animation", {
            animations: createdAnimations,
          });
          recordCurrentCapabilitySemanticHistoryEffect("create_animation");
          editStarted = false;
  
          const requestedParticleEffectCount = particle_effects
            ? Object.values(particle_effects).reduce(
                (count, particleOrParticles) =>
                  count +
                  (Array.isArray(particleOrParticles)
                    ? particleOrParticles.length
                    : 1),
                0
              )
            : 0;
          const requestedSoundEffectCount = sound_effects
            ? Object.values(sound_effects).reduce(
                (count, soundOrSounds) => count + (Array.isArray(soundOrSounds) ? soundOrSounds.length : 1),
                0
              )
            : 0;
          const result = {
            animation: {
              uuid: createdAnimation.uuid,
              name: createdAnimation.name,
              loop: createdAnimation.loop,
              length: createdAnimation.length,
              snapping: createdAnimation.snapping,
            },
            requested_name: requestedAnimationName,
            requested_bone_count: Object.keys(bones).length,
            requested_particle_effect_count: requestedParticleEffectCount,
            requested_sound_effect_count: requestedSoundEffectCount,
          };
  
          return {
            content: [
              {
                type: "text" as const,
                text: `Created animation "${createdAnimation.name}" (${createdAnimation.uuid}) for ${result.requested_bone_count} bone(s); ${requestedParticleEffectCount} particle and ${requestedSoundEffectCount} sound effect keyframe(s) requested.`,
              },
            ],
            structuredContent: result,
          };
        } catch (error) {
          const createdDuringAttempt = AnimationItem.all.filter(
            (animation) => !animationUuidsBefore.has(animation.uuid)
          );
          createdDuringAttempt.forEach((animation) => {
            animation.remove(false, false);
          });
          if (editStarted) {
            Undo.cancelEdit(true);
          }
          throw error;
        }
      },
    },
    createAnimationToolDoc.status
  );
}