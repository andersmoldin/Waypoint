// Vitest's way to read a page as text. The webpack build has no rule for it.
declare module "*.html?raw" {
  const content: string;
  export default content;
}
