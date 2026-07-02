-- MonitorFlow ER v3 (CLAUDE.md Section 5)

CREATE TABLE department (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user', 'employee', 'monitor')),
  phone         TEXT,
  department_id INTEGER REFERENCES department(id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE service_type (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  department_id    INTEGER NOT NULL REFERENCES department(id),
  default_priority TEXT NOT NULL CHECK (default_priority IN ('low', 'medium', 'high')),
  enabled          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE form_definition (
  id              SERIAL PRIMARY KEY,
  service_type_id INTEGER NOT NULL REFERENCES service_type(id),
  form_type       TEXT NOT NULL CHECK (form_type IN ('request', 'completion')),
  field_schema    JSONB NOT NULL,
  UNIQUE (service_type_id, form_type)
);

CREATE TABLE workflow_definition (
  id              SERIAL PRIMARY KEY,
  service_type_id INTEGER NOT NULL UNIQUE REFERENCES service_type(id),
  statuses        JSONB NOT NULL,
  transitions     JSONB NOT NULL
);

CREATE TABLE request (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  service_type_id INTEGER NOT NULL REFERENCES service_type(id),
  form_response   JSONB NOT NULL,
  status          TEXT NOT NULL,
  priority        TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE request_status_history (
  id         SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES request(id),
  status     TEXT NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);

CREATE TABLE task (
  id                       SERIAL PRIMARY KEY,
  request_id               INTEGER NOT NULL UNIQUE REFERENCES request(id),
  employee_id              INTEGER NOT NULL REFERENCES users(id),
  status                   TEXT NOT NULL,
  completion_form_response JSONB,
  assigned_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE request_comment (
  id         SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES request(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  request_id INTEGER REFERENCES request(id),
  type       TEXT NOT NULL CHECK (type IN ('assigned', 'status_changed', 'completed', 'task_rejected', 'comment')),
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE file_attachment (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        INTEGER REFERENCES request(id),
  task_id           INTEGER REFERENCES task(id),
  original_filename TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  storage_path      TEXT NOT NULL,
  uploaded_by       INTEGER NOT NULL REFERENCES users(id),
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((request_id IS NULL) <> (task_id IS NULL))
);

CREATE INDEX idx_request_user ON request(user_id);
CREATE INDEX idx_request_service_status ON request(service_type_id, status);
CREATE INDEX idx_task_employee ON task(employee_id);
CREATE INDEX idx_notification_user_read ON notification(user_id, is_read);
CREATE INDEX idx_history_request ON request_status_history(request_id);
CREATE INDEX idx_comment_request ON request_comment(request_id);
