-- 006_field_tasks.sql
-- GIS officer → field officer task assignment.
--
-- When a taxpayer record has no spatial data (arcgis_object_id IS NULL), a
-- GIS officer assigns a capture task to a field officer, who collects the
-- geometry with ArcGIS Field Maps / Survey123. The task auto-completes when
-- the record gains its arcgis_object_id (via manual link or sync).

-- New role. Existing roles: admin | finance_manager | officer.
INSERT INTO role (role_name)
SELECT 'gis_officer'
WHERE NOT EXISTS (SELECT 1 FROM role WHERE role_name = 'gis_officer');

CREATE TABLE IF NOT EXISTS field_task (
  task_id       SERIAL PRIMARY KEY,
  record_id     INT NOT NULL REFERENCES taxpayer_record(record_id) ON DELETE CASCADE,
  assigned_to   INT NOT NULL REFERENCES users(user_id),
  assigned_by   INT NOT NULL REFERENCES users(user_id),
  task_type     VARCHAR(30) NOT NULL DEFAULT 'spatial_capture',
  priority      VARCHAR(10) NOT NULL DEFAULT 'normal',   -- low | normal | high
  status        VARCHAR(20) NOT NULL DEFAULT 'open',     -- open | in_progress | done | cancelled
  instructions  TEXT,
  due_date      DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_field_task_assignee ON field_task (assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_field_task_record   ON field_task (record_id);

-- One ACTIVE capture task per record — repeated assignment should update the
-- existing task, not stack duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_task_active_per_record
  ON field_task (record_id, task_type)
  WHERE status IN ('open', 'in_progress');
