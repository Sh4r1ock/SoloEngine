declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

declare module '*.css?inline' {
  const css: string
  export default css
}
