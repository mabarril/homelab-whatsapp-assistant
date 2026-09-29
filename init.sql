CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS evolution;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS print_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    filament_cost_per_kg NUMERIC(10, 2) NOT NULL DEFAULT 150.00,
    printer_power_watts NUMERIC(10, 2) NOT NULL DEFAULT 250.00,
    kwh_cost NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    depreciation_cost_per_hour NUMERIC(10, 2) NOT NULL DEFAULT 2.00,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS print_calculations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_name VARCHAR(150) NOT NULL,
    weight_grams NUMERIC(10, 2) NOT NULL,
    print_time_hours NUMERIC(10, 2) NOT NULL,
    kwh_consumed NUMERIC(10, 3) NOT NULL,
    material_cost NUMERIC(10, 2) NOT NULL,
    energy_cost NUMERIC(10, 2) NOT NULL,
    depreciation_cost NUMERIC(10, 2) NOT NULL,
    total_cost NUMERIC(10, 2) NOT NULL,
    price_profit_30 NUMERIC(10, 2) NOT NULL,
    price_profit_50 NUMERIC(10, 2) NOT NULL,
    price_profit_100 NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insira seu número de telefone aqui (DDI + DDD + Número)
INSERT INTO users (phone_number, name, role) VALUES 
('556181306655', 'Barril', 'ADMIN')
ON CONFLICT (phone_number) DO NOTHING;

INSERT INTO conversations (user_id, is_active)
SELECT id, true FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM conversations c WHERE c.user_id = u.id
);

INSERT INTO print_settings (user_id)
SELECT id FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM print_settings ps WHERE ps.user_id = u.id
);
