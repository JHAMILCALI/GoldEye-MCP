CREATE TABLE IF NOT EXISTS propuestas (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('candidato', 'sugerencia')),
  clave TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente_revision', 'aceptada', 'rechazada')),
  contenido TEXT NOT NULL,
  agente TEXT NOT NULL,
  creado_en TEXT NOT NULL,
  revisor TEXT,
  revisado_en TEXT,
  UNIQUE (tipo, clave)
);

CREATE INDEX IF NOT EXISTS propuestas_estado_fecha ON propuestas (estado, creado_en DESC);
