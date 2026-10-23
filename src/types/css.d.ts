// Lets TypeScript accept plain stylesheet imports like `import "./globals.css"`.
// Newer TypeScript versions check side-effect imports and Next only declares *.module.css.
declare module "*.css";
