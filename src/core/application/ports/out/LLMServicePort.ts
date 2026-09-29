import { User } from '../../../domain/entities/User.js';
import { Message } from '../../../domain/entities/Message.js';
import { PrintSettings, PrintCalculation } from '../../../domain/entities/PrintCalculation.js';

export interface GenerateResponseOptions {
  user: User;
  conversationHistory: Message[];
  currentMessage: string;
  printSettings: PrintSettings;
  onExecutePrintCalculation: (data: {
    projectName: string;
    weightGrams: number;
    printTimeHours: number;
  }) => Promise<PrintCalculation>;
  onUpdatePrintSettings: (data: {
    filamentCostPerKg?: number;
    printerPowerWatts?: number;
    kwhCost?: number;
    depreciationCostPerHour?: number;
  }) => Promise<PrintSettings>;
}

export interface LLMServicePort {
  generateResponse(options: GenerateResponseOptions): Promise<string>;
}
