// Isolated, minimal Zotero-shaped database. Never opens a user's Zotero directory.
const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),{join}=require('node:path')
module.exports=function(root){fs.mkdirSync(join(root,'storage','ATTACH01'),{recursive:true});fs.mkdirSync(join(root,'storage','ORPHAN01'),{recursive:true});require('./make-fixture.cjs')(join(root,'storage','ATTACH01','fixture.pdf'));require('./make-fixture.cjs')(join(root,'storage','ORPHAN01','orphan.pdf'))
 const db=new DatabaseSync(join(root,'zotero.sqlite'))
 db.exec(`CREATE TABLE version(schema TEXT,version TEXT);INSERT INTO version VALUES('userdata','999');
 CREATE TABLE items(itemID INTEGER,itemTypeID INTEGER,key TEXT,libraryID INTEGER);INSERT INTO items VALUES(1,1,'ARTICLE1',1),(2,2,'ATTACH01',1),(3,2,'ORPHAN01',1),(4,3,'ANNOT001',1),(5,4,'NOTE0001',1);
 CREATE TABLE itemTypes(itemTypeID INTEGER,typeName TEXT);INSERT INTO itemTypes VALUES(1,'journalArticle'),(2,'attachment'),(3,'annotation'),(4,'note');
 CREATE TABLE fieldsCombined(fieldID INTEGER,fieldName TEXT);INSERT INTO fieldsCombined VALUES(1,'title'),(2,'date'),(3,'DOI');
 CREATE TABLE itemData(itemID INTEGER,fieldID INTEGER,valueID INTEGER);INSERT INTO itemData VALUES(1,1,1),(1,2,2),(1,3,3),(2,1,4),(3,1,5);
 CREATE TABLE itemDataValues(valueID INTEGER,value TEXT);INSERT INTO itemDataValues VALUES(1,'A synthetic Zotero article'),(2,'2026'),(3,'10.1234/zotero-fixture'),(4,'Original linked PDF'),(5,'Standalone original');
 CREATE TABLE creators(creatorID INTEGER,firstName TEXT,lastName TEXT,fieldMode INTEGER);INSERT INTO creators VALUES(1,'Alice','Example',0);
 CREATE TABLE itemCreators(itemID INTEGER,creatorID INTEGER,creatorTypeID INTEGER,orderIndex INTEGER);INSERT INTO itemCreators VALUES(1,1,1,0);
 CREATE TABLE collections(collectionID INTEGER,collectionName TEXT,parentCollectionID INTEGER,key TEXT,libraryID INTEGER);INSERT INTO collections VALUES(1,'Research',NULL,'COLLECT1',1);
 CREATE TABLE collectionItems(collectionID INTEGER,itemID INTEGER);INSERT INTO collectionItems VALUES(1,1);
 CREATE TABLE tags(tagID INTEGER,name TEXT);INSERT INTO tags VALUES(1,'Evidence');CREATE TABLE itemTags(itemID INTEGER,tagID INTEGER);INSERT INTO itemTags VALUES(1,1);
 CREATE TABLE itemAttachments(itemID INTEGER,parentItemID INTEGER,linkMode INTEGER,contentType TEXT,path TEXT);INSERT INTO itemAttachments VALUES(2,1,0,'application/pdf','storage:fixture.pdf'),(3,NULL,0,'application/pdf','storage:orphan.pdf');
 CREATE TABLE itemNotes(itemID INTEGER,parentItemID INTEGER,note TEXT);INSERT INTO itemNotes VALUES(5,1,'<p>A preserved Zotero note.</p>');
 CREATE TABLE itemAnnotations(itemID INTEGER,parentItemID INTEGER,type INTEGER,text TEXT,comment TEXT,color TEXT,pageLabel TEXT,sortIndex TEXT,position TEXT);INSERT INTO itemAnnotations VALUES(4,2,1,'Original quotation','Preserved comment','#ffd400','1','00001','{"pageIndex":0,"rects":[[40,60,220,90]]}');
 CREATE TABLE deletedItems(itemID INTEGER);`);db.close();return root}
