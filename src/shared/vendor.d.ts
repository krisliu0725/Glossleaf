declare module 'citeproc' {
 const CSL: { Engine: new (system: { retrieveLocale(lang: string): string; retrieveItem(id: string): unknown }, style: string, language?: string) => { setOutputFormat(format: string): void; updateItems(ids: string[]): void; makeBibliography(): [unknown,string[]] | false } }
 export default CSL
}
declare module '*.csl?raw' { const source: string; export default source }
declare module '*.xml?raw' { const source: string; export default source }
