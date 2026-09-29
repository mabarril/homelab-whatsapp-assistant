import pg from 'pg';
import { PrintCalculation, PrintSettings } from '../../../../core/domain/entities/PrintCalculation.js';
import { PrintRepositoryPort, UpdatePrintSettingsData } from '../../../../core/application/ports/out/PrintRepositoryPort.js';

export class PostgresPrintRepository implements PrintRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async getSettings(userId: string): Promise<PrintSettings> {
    const query = `
      SELECT user_id, filament_cost_per_kg, printer_power_watts, kwh_cost, depreciation_cost_per_hour, updated_at
      FROM print_settings
      WHERE user_id = $1
      LIMIT 1;
    `;
    let res = await this.pool.query(query, [userId]);

    // Se ainda não existir configuração para o usuário, insere os valores default
    if (res.rows.length === 0) {
      await this.pool.query(
        `INSERT INTO print_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING;`,
        [userId]
      );
      res = await this.pool.query(query, [userId]);
    }

    const row = res.rows[0];
    return {
      userId: row.user_id,
      filamentCostPerKg: parseFloat(row.filament_cost_per_kg),
      printerPowerWatts: parseFloat(row.printer_power_watts),
      kwhCost: parseFloat(row.kwh_cost),
      depreciationCostPerHour: parseFloat(row.depreciation_cost_per_hour),
      updatedAt: new Date(row.updated_at),
    };
  }

  async updateSettings(userId: string, data: UpdatePrintSettingsData): Promise<PrintSettings> {
    const current = await this.getSettings(userId);

    const filament = data.filamentCostPerKg ?? current.filamentCostPerKg;
    const power = data.printerPowerWatts ?? current.printerPowerWatts;
    const kwh = data.kwhCost ?? current.kwhCost;
    const depreciation = data.depreciationCostPerHour ?? current.depreciationCostPerHour;

    const query = `
      INSERT INTO print_settings (user_id, filament_cost_per_kg, printer_power_watts, kwh_cost, depreciation_cost_per_hour, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        filament_cost_per_kg = EXCLUDED.filament_cost_per_kg,
        printer_power_watts = EXCLUDED.printer_power_watts,
        kwh_cost = EXCLUDED.kwh_cost,
        depreciation_cost_per_hour = EXCLUDED.depreciation_cost_per_hour,
        updated_at = NOW()
      RETURNING user_id, filament_cost_per_kg, printer_power_watts, kwh_cost, depreciation_cost_per_hour, updated_at;
    `;

    const res = await this.pool.query(query, [userId, filament, power, kwh, depreciation]);
    const row = res.rows[0];

    return {
      userId: row.user_id,
      filamentCostPerKg: parseFloat(row.filament_cost_per_kg),
      printerPowerWatts: parseFloat(row.printer_power_watts),
      kwhCost: parseFloat(row.kwh_cost),
      depreciationCostPerHour: parseFloat(row.depreciation_cost_per_hour),
      updatedAt: new Date(row.updated_at),
    };
  }

  async saveCalculation(calc: Omit<PrintCalculation, 'id' | 'createdAt'>): Promise<PrintCalculation> {
    const query = `
      INSERT INTO print_calculations (
        user_id, project_name, weight_grams, print_time_hours,
        kwh_consumed, material_cost, energy_cost, depreciation_cost,
        total_cost, price_profit_30, price_profit_50, price_profit_100
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;

    const values = [
      calc.userId,
      calc.projectName,
      calc.weightGrams,
      calc.printTimeHours,
      calc.kwhConsumed,
      calc.materialCost,
      calc.energyCost,
      calc.depreciationCost,
      calc.totalCost,
      calc.priceProfit30,
      calc.priceProfit50,
      calc.priceProfit100,
    ];

    const res = await this.pool.query(query, values);
    const row = res.rows[0];

    return {
      id: row.id,
      userId: row.user_id,
      projectName: row.project_name,
      weightGrams: parseFloat(row.weight_grams),
      printTimeHours: parseFloat(row.print_time_hours),
      kwhConsumed: parseFloat(row.kwh_consumed),
      materialCost: parseFloat(row.material_cost),
      energyCost: parseFloat(row.energy_cost),
      depreciationCost: parseFloat(row.depreciation_cost),
      totalCost: parseFloat(row.total_cost),
      priceProfit30: parseFloat(row.price_profit_30),
      priceProfit50: parseFloat(row.price_profit_50),
      priceProfit100: parseFloat(row.price_profit_100),
      createdAt: new Date(row.created_at),
    };
  }

  async getRecentCalculations(userId: string, limit: number = 5): Promise<PrintCalculation[]> {
    const query = `
      SELECT *
      FROM print_calculations
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;
    const res = await this.pool.query(query, [userId, limit]);
    return res.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      projectName: row.project_name,
      weightGrams: parseFloat(row.weight_grams),
      printTimeHours: parseFloat(row.print_time_hours),
      kwhConsumed: parseFloat(row.kwh_consumed),
      materialCost: parseFloat(row.material_cost),
      energyCost: parseFloat(row.energy_cost),
      depreciationCost: parseFloat(row.depreciation_cost),
      totalCost: parseFloat(row.total_cost),
      priceProfit30: parseFloat(row.price_profit_30),
      priceProfit50: parseFloat(row.price_profit_50),
      priceProfit100: parseFloat(row.price_profit_100),
      createdAt: new Date(row.created_at),
    }));
  }
}
