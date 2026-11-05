export interface LeadLossDiagnostic {
  diagnosticId: string | null;
  companyName: string | null;
  leadsPerMonth: number | null;
  clientsPerMonth: number | null;
  conversionRate: number | null;
  margin: number | null;
  averageSaleValue: number | null;
  frictions: string[];
  estimatedRecovery: number | null;
}

export const LEADLOSS_MAX_FILE_BYTES = 2 * 1024 * 1024;

export function isLeadLossFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.md') || file.type === 'text/markdown';
}

function extractValue(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function extractNumber(text: string, regex: RegExp): number | null {
  const value = extractValue(text, regex);
  if (!value) return null;
  const parsed = parseFloat(value.replace(/\s/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractFrictions(text: string): string[] {
  const section = text.match(/FRICTIONS CONFIRM[ÉE]ES([\s\S]*?)(?=\n\n|\[CLASSEMENT|$)/i);
  if (!section) return [];
  const frictions: string[] = [];
  for (const line of section[1].match(/\[.\]\s+[^:\n]+:\s+Confirm[ée]e/gi) ?? []) {
    const match = line.match(/\[.\]\s+([^:\n]+):\s+Confirm/i);
    if (match) frictions.push(match[1].trim());
  }
  return frictions;
}

export function parseLeadLossDiagnostic(text: string): LeadLossDiagnostic {
  return {
    diagnosticId: extractValue(text, /"diagnosticId":\s*"([^"]+)"/i),
    companyName: extractValue(text, /Entreprise\s*:\s*(.+)/i),
    leadsPerMonth: extractNumber(text, /Leads entrants \/ mois\s*:\s*(\d+)/i),
    clientsPerMonth: extractNumber(text, /Clients obtenus \/ mois\s*:\s*(\d+)/i),
    conversionRate: extractNumber(text, /Taux de conversion actuel\s*:\s*(\d+)%/i),
    margin: extractNumber(text, /Marge contributive moyenne\s*:\s*([\d\s]+)€/i),
    averageSaleValue: extractNumber(text, /Valeur moyenne d'une vente\s*:\s*([\d\s]+)€/i),
    frictions: extractFrictions(text),
    estimatedRecovery: extractNumber(text, /Valeur estim[ée]e de r[ée]cup[ée]ration\s*:\s*([\d\s]+)€\s*\/\s*mois/i),
  };
}
