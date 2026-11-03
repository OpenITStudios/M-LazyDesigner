/**
 * Type declarations for importing text files as strings
 * These are processed by the text-file-loader plugin in build.ts
 */

declare module "*.html" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.svg" {
  const content: string;
  export default content;
}

/** Bun `with { type: "text" }` imports original Markdown, not rendered HTML. */
declare module "*.md" {
  const content: string;
  export default content;
}

/** Trusted bundled Blender worker, loaded without minification. */
declare module "*.py" {
  const content: string;
  export default content;
}
