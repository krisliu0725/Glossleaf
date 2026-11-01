export function readablePdf(doc:{contentType:string;activeVersionId:string|null}):boolean {
 return doc.contentType==='application/pdf'&&!!doc.activeVersionId
}
