/**
 * 领域模型 DDL。对应 DESIGN.md §10.2 / §10.4。
 *
 * 三条不变量，改动 schema 前请先确认没有破坏它们：
 * 1. 所有可导入实体都有 entity 行，外部身份只进 origin_map，不做主键。
 * 2. document_version 恰有「受管理文件」或「外部授权」之一，由 CHECK 约束保证。
 * 3. 布局缓存、检索投影可重建；用户创作数据（摘录、笔记、译文记录、术语、阅读位置）不可重建。
 */

export const SCHEMA_VERSION = 7

/**
 * 增量迁移。键是目标版本号，值是该版本要执行的 SQL。
 * 全新库先跑 SCHEMA_SQL（v1），再依次跑 v2..N，保证「新库」与「升级库」结构一致。
 */
export const MIGRATIONS: Record<number, string> = {
  7: `ALTER TABLE annotation ADD COLUMN markStyle TEXT NOT NULL DEFAULT 'highlight' CHECK(markStyle IN ('highlight','underline'));`,
  6: `ALTER TABLE annotation ADD COLUMN paletteId TEXT NOT NULL DEFAULT 'legacy';
  ALTER TABLE annotation ADD COLUMN slot INTEGER;
  ALTER TABLE annotation ADD COLUMN sourcePayload TEXT;
  ALTER TABLE annotation ADD COLUMN stackOrder INTEGER NOT NULL DEFAULT 0;
  UPDATE annotation SET stackOrder=rowid;
  CREATE TRIGGER annotation_stack_order AFTER INSERT ON annotation WHEN NEW.stackOrder=0 BEGIN UPDATE annotation SET stackOrder=(SELECT coalesce(max(stackOrder),0)+1 FROM annotation) WHERE id=NEW.id; END;
  ALTER TABLE annotation ADD COLUMN highlightId TEXT REFERENCES annotation(id);
  CREATE INDEX annotation_parent ON annotation(highlightId);
  UPDATE annotation SET paletteId='zotero' WHERE id IN (SELECT entityId FROM origin_map WHERE entityKind='annotation');
  UPDATE annotation SET type='source' WHERE type='note' AND trim(coalesce(comment,''))='';
  CREATE TRIGGER annotation_note_body_insert BEFORE INSERT ON annotation WHEN NEW.type='note' AND trim(coalesce(NEW.comment,''))='' BEGIN SELECT RAISE(ABORT,'Margin note body must not be empty'); END;
  CREATE TRIGGER annotation_note_body_update BEFORE UPDATE ON annotation WHEN NEW.type='note' AND trim(coalesce(NEW.comment,''))='' BEGIN SELECT RAISE(ABORT,'Margin note body must not be empty'); END;
  CREATE VIEW reading_items AS SELECT a.*,e.createdAt,e.updatedAt,e.revision FROM annotation a JOIN entity e ON e.id=a.id WHERE e.deletedAt IS NULL;
  `,
  5: `CREATE TABLE external_file_grant (
    id TEXT PRIMARY KEY, absolutePath TEXT NOT NULL, fingerprint TEXT NOT NULL,
    byteSize INTEGER NOT NULL, modifiedAt REAL NOT NULL, verifiedAt TEXT NOT NULL,
    UNIQUE(absolutePath,fingerprint)
  );
  CREATE INDEX external_file_path ON external_file_grant(absolutePath);`,
  4: /* sql */ `
    CREATE TABLE analytics_reading (
      id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, documentVersionId TEXT NOT NULL,
      itemId TEXT, pageIndex INTEGER NOT NULL, startedAt TEXT NOT NULL, finishedAt TEXT NOT NULL,
      visit INTEGER NOT NULL CHECK(visit IN(0,1)), characters INTEGER, words INTEGER
    );
    CREATE INDEX analytics_reading_date ON analytics_reading(startedAt);
    CREATE TABLE analytics_attempt (
      id TEXT PRIMARY KEY, operationId TEXT NOT NULL, attempt INTEGER NOT NULL,
      startedAt TEXT NOT NULL, finishedAt TEXT NOT NULL, provider TEXT NOT NULL,
      endpointHost TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL,
      httpStatus INTEGER, inputTokens INTEGER, outputTokens INTEGER, totalTokens INTEGER,
      cachedInputTokens INTEGER, reasoningTokens INTEGER, estimatedInputTokens INTEGER NOT NULL,
      estimatedOutputTokens INTEGER NOT NULL
    );
    CREATE INDEX analytics_attempt_date ON analytics_attempt(startedAt);
    CREATE TABLE analytics_operation (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, count INTEGER NOT NULL, createdAt TEXT NOT NULL);
    CREATE INDEX analytics_operation_date ON analytics_operation(createdAt);
    CREATE TABLE analytics_classification (itemId TEXT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE, topicsJson TEXT NOT NULL, field TEXT, confirmedAt TEXT NOT NULL);
  `,
  3: /* sql */ `
    CREATE TABLE search_source (
      rowid INTEGER PRIMARY KEY,
      sourceKey TEXT NOT NULL UNIQUE,
      itemId TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      documentVersionId TEXT REFERENCES document_version(id) ON DELETE CASCADE,
      pageIndex INTEGER,
      annotationId TEXT,
      rawText TEXT NOT NULL,
      normalizedText TEXT NOT NULL,
      offsetsJson TEXT NOT NULL,
      runsJson TEXT NOT NULL DEFAULT '[]',
      normalizationVersion INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX search_source_item ON search_source(itemId);
    CREATE INDEX search_source_document ON search_source(documentVersionId,pageIndex);
    CREATE VIRTUAL TABLE search_content_fts USING fts5(normalizedText, tokenize='trigram');
    CREATE TRIGGER search_source_insert AFTER INSERT ON search_source BEGIN
      INSERT INTO search_content_fts(rowid,normalizedText) VALUES(new.rowid,new.normalizedText);
    END;
    CREATE TRIGGER search_source_update AFTER UPDATE ON search_source BEGIN
      DELETE FROM search_content_fts WHERE rowid=old.rowid;
      INSERT INTO search_content_fts(rowid,normalizedText) VALUES(new.rowid,new.normalizedText);
    END;
    CREATE TRIGGER search_source_delete AFTER DELETE ON search_source BEGIN
      DELETE FROM search_content_fts WHERE rowid=old.rowid;
    END;
    CREATE TABLE search_dirty (sourceKey TEXT PRIMARY KEY, kind TEXT NOT NULL, entityId TEXT NOT NULL);
    INSERT INTO search_dirty SELECT 'item:'||id,'metadata',id FROM item;
    INSERT INTO search_dirty SELECT 'annotation:'||id,'excerpts',id FROM annotation;
    CREATE TABLE document_index (
      documentVersionId TEXT PRIMARY KEY REFERENCES document_version(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      parserVersion TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      pageCount INTEGER,
      error TEXT,
      updatedAt TEXT NOT NULL
    );
    CREATE TRIGGER item_search_insert AFTER INSERT ON item BEGIN
      INSERT INTO search_dirty VALUES('item:'||new.id,'metadata',new.id) ON CONFLICT(sourceKey) DO UPDATE SET entityId=excluded.entityId;
    END;
    CREATE TRIGGER item_search_update AFTER UPDATE ON item BEGIN
      INSERT INTO search_dirty VALUES('item:'||new.id,'metadata',new.id) ON CONFLICT(sourceKey) DO UPDATE SET entityId=excluded.entityId;
    END;
    CREATE TRIGGER creator_search_insert AFTER INSERT ON item_creator BEGIN
      INSERT INTO search_dirty VALUES('item:'||new.itemId,'metadata',new.itemId) ON CONFLICT(sourceKey) DO UPDATE SET entityId=excluded.entityId;
    END;
    CREATE TRIGGER creator_search_delete AFTER DELETE ON item_creator BEGIN
      INSERT INTO search_dirty VALUES('item:'||old.itemId,'metadata',old.itemId) ON CONFLICT(sourceKey) DO UPDATE SET entityId=excluded.entityId;
    END;
    CREATE TRIGGER creator_search_update AFTER UPDATE ON item_creator BEGIN
      INSERT INTO search_dirty VALUES('item:'||new.itemId,'metadata',new.itemId) ON CONFLICT(sourceKey) DO UPDATE SET entityId=excluded.entityId;
    END;
    CREATE TRIGGER item_tag_search_insert AFTER INSERT ON item_tag BEGIN
      INSERT INTO search_dirty VALUES('item:'||new.itemId,'metadata',new.itemId) ON CONFLICT(sourceKey) DO UPDATE SET entityId=excluded.entityId;
    END;
    CREATE TRIGGER item_tag_search_delete AFTER DELETE ON item_tag BEGIN
      INSERT INTO search_dirty VALUES('item:'||old.itemId,'metadata',old.itemId) ON CONFLICT(sourceKey) DO UPDATE SET entityId=excluded.entityId;
    END;
    CREATE TRIGGER tag_search_update AFTER UPDATE OF name ON tag BEGIN
      INSERT INTO search_dirty SELECT 'item:'||itemId,'metadata',itemId FROM item_tag WHERE tagId=new.id ON CONFLICT(sourceKey) DO UPDATE SET entityId=excluded.entityId;
    END;
    CREATE TRIGGER annotation_search_insert AFTER INSERT ON annotation BEGIN
      INSERT INTO search_dirty VALUES('annotation:'||new.id,'excerpts',new.id) ON CONFLICT(sourceKey) DO UPDATE SET entityId=excluded.entityId;
    END;
    CREATE TRIGGER annotation_search_update AFTER UPDATE ON annotation BEGIN
      INSERT INTO search_dirty VALUES('annotation:'||new.id,'excerpts',new.id) ON CONFLICT(sourceKey) DO UPDATE SET entityId=excluded.entityId;
    END;
    CREATE TRIGGER translation_record_search_update AFTER UPDATE OF output ON translation_record BEGIN
      INSERT INTO search_dirty SELECT 'annotation:'||id,'excerpts',id FROM annotation WHERE translationRecordId=new.id ON CONFLICT(sourceKey) DO UPDATE SET entityId=excluded.entityId;
    END;
    CREATE TRIGGER annotation_search_delete AFTER DELETE ON annotation BEGIN
      DELETE FROM search_source WHERE sourceKey='annotation:'||old.id;
      DELETE FROM search_dirty WHERE sourceKey='annotation:'||old.id;
    END;
  `,
  2: /* sql */ `
    -- 一次导入运行的记录。预备数据在 publish 前不可见（§11.6）
    CREATE TABLE IF NOT EXISTS import_run (
      id               TEXT PRIMARY KEY,
      sourceInstanceId TEXT,
      snapshotId       TEXT,
      adapterVersion   TEXT NOT NULL,
      status           TEXT NOT NULL
                       CHECK (status IN ('running','published','failed','cancelled')),
      startedAt        TEXT NOT NULL,
      finishedAt       TEXT,
      countsJson       TEXT,
      warningsJson     TEXT,
      conflictsJson    TEXT,
      error            TEXT
    );

    -- 关系贡献来源：来源新增可并入，来源移除只撤自己的贡献（§11.7）
    ALTER TABLE item_tag ADD COLUMN originSourceId TEXT;
    ALTER TABLE collection_item ADD COLUMN originSourceId TEXT;

    -- 本地对来源关系的显式移除，避免下次导入自动补回
    CREATE TABLE IF NOT EXISTS relation_override (
      id           TEXT PRIMARY KEY,
      entityId     TEXT NOT NULL,
      relationKind TEXT NOT NULL,
      targetId     TEXT NOT NULL,
      action       TEXT NOT NULL,
      createdAt    TEXT NOT NULL,
      UNIQUE (entityId, relationKind, targetId)
    );

    -- 冲突记录：同一字段两端修改时保留本地，并留下可解释的痕迹
    CREATE TABLE IF NOT EXISTS import_conflict (
      id        TEXT PRIMARY KEY,
      runId     TEXT NOT NULL,
      entityId  TEXT NOT NULL,
      field     TEXT NOT NULL,
      localJson TEXT,
      sourceJson TEXT,
      baseJson  TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS import_conflict_run ON import_conflict(runId);
  `
}

export const SCHEMA_SQL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------- 统一身份 ----------
CREATE TABLE IF NOT EXISTS entity (
  id        TEXT PRIMARY KEY,
  kind      TEXT NOT NULL CHECK (kind IN ('item','collection','tag','document','annotation','note')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  revision  INTEGER NOT NULL DEFAULT 1,
  deletedAt TEXT
);
CREATE INDEX IF NOT EXISTS entity_kind ON entity(kind);

-- ---------- 文献 ----------
CREATE TABLE IF NOT EXISTS item (
  id            TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  fieldsJson    TEXT NOT NULL DEFAULT '{}',
  language      TEXT,
  date          TEXT,
  datePrecision TEXT
);
CREATE INDEX IF NOT EXISTS item_type ON item(type);

CREATE TABLE IF NOT EXISTS item_creator (
  itemId      TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  orderIndex  INTEGER NOT NULL,
  role        TEXT NOT NULL DEFAULT 'author',
  nameMode    TEXT NOT NULL CHECK (nameMode IN ('person','literal')),
  givenName   TEXT,
  familyName  TEXT,
  literalName TEXT,
  PRIMARY KEY (itemId, orderIndex)
);

-- ---------- 集合与标签 ----------
CREATE TABLE IF NOT EXISTS collection (
  id       TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  parentId TEXT REFERENCES collection(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS collection_parent ON collection(parentId);

CREATE TABLE IF NOT EXISTS collection_item (
  collectionId TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  itemId       TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  origin       TEXT NOT NULL DEFAULT 'local',
  PRIMARY KEY (collectionId, itemId)
);
CREATE INDEX IF NOT EXISTS collection_item_item ON collection_item(itemId);

CREATE TABLE IF NOT EXISTS tag (
  id   TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tag_name_unique ON tag(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS item_tag (
  itemId TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  tagId  TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  origin TEXT NOT NULL DEFAULT 'local',
  PRIMARY KEY (itemId, tagId)
);

-- ---------- 附件与文件 ----------
CREATE TABLE IF NOT EXISTS file_blob (
  sha256       TEXT PRIMARY KEY,
  relativePath TEXT NOT NULL,
  byteSize     INTEGER NOT NULL,
  verifiedAt   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document (
  id              TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  itemId          TEXT REFERENCES item(id) ON DELETE CASCADE,
  displayName     TEXT NOT NULL,
  contentType     TEXT NOT NULL,
  activeVersionId TEXT,
  availability    TEXT NOT NULL DEFAULT 'managed'
                  CHECK (availability IN ('managed','missing','pending','url'))
);
CREATE INDEX IF NOT EXISTS document_item ON document(itemId);

CREATE TABLE IF NOT EXISTS document_version (
  id              TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  documentId      TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  blobHash        TEXT REFERENCES file_blob(sha256),
  externalGrantId TEXT,
  fingerprint     TEXT NOT NULL,
  pageCount       INTEGER,
  status          TEXT NOT NULL DEFAULT 'ready'
                  CHECK (status IN ('ready','indexing','missing','unsupported')),
  CHECK (blobHash IS NOT NULL OR externalGrantId IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS document_version_document ON document_version(documentId);

-- ---------- 用户创作数据 ----------
CREATE TABLE IF NOT EXISTS annotation (
  id                  TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  documentVersionId   TEXT NOT NULL REFERENCES document_version(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  quote               TEXT NOT NULL,
  comment             TEXT,
  color               TEXT,
  anchorsJson         TEXT NOT NULL,
  translationRecordId TEXT
);
CREATE INDEX IF NOT EXISTS annotation_version ON annotation(documentVersionId);

CREATE TABLE IF NOT EXISTS note (
  id                   TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  itemId               TEXT REFERENCES item(id) ON DELETE CASCADE,
  format               TEXT NOT NULL DEFAULT 'text',
  body                 TEXT NOT NULL,
  importedOriginalHtml TEXT
);
CREATE INDEX IF NOT EXISTS note_item ON note(itemId);

CREATE TABLE IF NOT EXISTS translation_record (
  id                  TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  inputSnapshot       TEXT NOT NULL,
  output              TEXT NOT NULL,
  providerFingerprint TEXT NOT NULL,
  status              TEXT NOT NULL,
  createdAt           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glossary_entry (
  id        TEXT PRIMARY KEY,
  scope     TEXT NOT NULL CHECK (scope IN ('library','item')),
  scopeId   TEXT,
  source    TEXT NOT NULL,
  target    TEXT NOT NULL,
  matchMode TEXT NOT NULL DEFAULT 'exact',
  revision  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS glossary_scope ON glossary_entry(scope, scopeId);

CREATE TABLE IF NOT EXISTS reading_state (
  documentVersionId TEXT PRIMARY KEY REFERENCES document_version(id) ON DELETE CASCADE,
  pageIndex         INTEGER NOT NULL DEFAULT 0,
  anchor            TEXT,
  zoom              REAL NOT NULL DEFAULT 1,
  mode              TEXT NOT NULL DEFAULT 'stable',
  panes             TEXT
);

-- ---------- 外部来源 ----------
CREATE TABLE IF NOT EXISTS source_instance (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  label          TEXT NOT NULL,
  boundPath      TEXT NOT NULL,
  descriptorJson TEXT NOT NULL,
  createdAt      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_snapshot (
  id               TEXT PRIMARY KEY,
  sourceInstanceId TEXT NOT NULL REFERENCES source_instance(id) ON DELETE CASCADE,
  runId            TEXT NOT NULL,
  schemaVersion    TEXT,
  descriptorHash   TEXT NOT NULL,
  capturedAt       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS origin_map (
  id               TEXT PRIMARY KEY,
  sourceInstanceId TEXT NOT NULL REFERENCES source_instance(id) ON DELETE CASCADE,
  sourceLibraryId  TEXT NOT NULL,
  entityKind       TEXT NOT NULL,
  externalKey      TEXT NOT NULL,
  entityId         TEXT NOT NULL,
  UNIQUE (sourceInstanceId, sourceLibraryId, entityKind, externalKey)
);
CREATE INDEX IF NOT EXISTS origin_map_entity ON origin_map(entityId);

CREATE TABLE IF NOT EXISTS origin_revision (
  id               TEXT PRIMARY KEY,
  originMapId      TEXT NOT NULL REFERENCES origin_map(id) ON DELETE CASCADE,
  snapshotId       TEXT NOT NULL REFERENCES source_snapshot(id) ON DELETE CASCADE,
  rawJson          TEXT NOT NULL,
  normalizedJson   TEXT NOT NULL,
  sourceRevision   TEXT
);

-- ---------- 可重建缓存 ----------
CREATE TABLE IF NOT EXISTS layout_cache (
  documentVersionId TEXT NOT NULL REFERENCES document_version(id) ON DELETE CASCADE,
  pageIndex         INTEGER NOT NULL,
  parserVersion     TEXT NOT NULL,
  geometryHash      TEXT NOT NULL,
  payload           TEXT NOT NULL,
  PRIMARY KEY (documentVersionId, pageIndex, parserVersion)
);

CREATE TABLE IF NOT EXISTS layout_override (
  id                TEXT PRIMARY KEY,
  documentVersionId TEXT NOT NULL REFERENCES document_version(id) ON DELETE CASCADE,
  anchor            TEXT NOT NULL,
  operation         TEXT NOT NULL,
  parserVersion     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS translation_cache (
  inputHash           TEXT PRIMARY KEY,
  state               TEXT NOT NULL,
  output              TEXT,
  providerFingerprint TEXT NOT NULL,
  validation          TEXT,
  createdAt           TEXT NOT NULL,
  lastUsedAt          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_projection (
  itemId         TEXT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  summary        TEXT NOT NULL,
  normalizedText TEXT NOT NULL,
  pageMap        TEXT,
  indexedAt      TEXT
);

-- 中文全文：trigram 对 >=3 字查询有效；1-2 字查询由检索层降级到 LIKE 扫描（M0 实测结论）
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  itemId UNINDEXED,
  title,
  body,
  tokenize = 'trigram'
);

-- ---------- 任务 ----------
CREATE TABLE IF NOT EXISTS job (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  configJson  TEXT NOT NULL,
  progressJson TEXT,
  createdAt   TEXT NOT NULL,
  finishedAt  TEXT
);

CREATE TABLE IF NOT EXISTS job_unit (
  jobId   TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  unitKey TEXT NOT NULL,
  status  TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  error   TEXT,
  PRIMARY KEY (jobId, unitKey)
);
`
