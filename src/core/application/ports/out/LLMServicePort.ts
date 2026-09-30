import { User } from '../../../domain/entities/User.js';
import { Message } from '../../../domain/entities/Message.js';
import { PrintSettings, PrintCalculation } from '../../../domain/entities/PrintCalculation.js';

export interface PrintCalculationResult {
  calculation: PrintCalculation;
  /** Parâmetros usados no cálculo (lidos do banco no momento da execução). */
  settings: PrintSettings;
}

export interface GenerateResponseOptions {
  user: User;
  conversationHistory: Message[];
  currentMessage: string;
  printSettings: PrintSettings;
  onExecutePrintCalculation: (data: {
    projectName: string;
    weightGrams: number;
    printTimeHours: number;
  }) => Promise<PrintCalculationResult>;
  onUpdatePrintSettings: (data: {
    filamentCostPerKg?: number;
    printerPowerWatts?: number;
    kwhCost?: number;
    depreciationCostPerHour?: number;
  }) => Promise<PrintSettings>;
  onGetPrintSettings: () => Promise<PrintSettings>;
}

/** Falha ao obter resposta do provedor de LLM (rede, cota, bloqueio, loop de ferramentas...). */
export class LLMUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LLMUnavailableError';
  }
}

export interface LLMServicePort {
  generateResponse(options: GenerateResponseOptions): Promise<string>;
}
