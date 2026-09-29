export interface AppConfig {
  port: number;
  simulatorBaseUrl: string;
  databaseUrl: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  geminiModel: string;
  operatorToken: string;
  pollIntervalMs: number;
  simTimeoutMs: number;
  monteCarloRuns: number;
  forecastHorizonTicks: number;
  mlServiceUrl: string;
  urgencyCriticalHours: number;
  urgencyHighHours: number;
  urgencyMediumHours: number;
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT || '4000', 10),
  simulatorBaseUrl: process.env.SIMULATOR_BASE_URL || 'http://simulator-api:8000',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fuel?schema=public',
  geminiApiKey: process.env.GEMINI_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  operatorToken: process.env.OPERATOR_TOKEN || 'fuel-operator-secret-2026',
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '3000', 10),
  simTimeoutMs: parseInt(process.env.SIM_TIMEOUT_MS || '3000', 10),
  monteCarloRuns: parseInt(process.env.MONTE_CARLO_RUNS || '200', 10),
  forecastHorizonTicks: parseInt(process.env.FORECAST_HORIZON_TICKS || '96', 10),
  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:5000',
  urgencyCriticalHours: parseFloat(process.env.URGENCY_CRITICAL_HOURS || '6'),
  urgencyHighHours: parseFloat(process.env.URGENCY_HIGH_HOURS || '12'),
  urgencyMediumHours: parseFloat(process.env.URGENCY_MEDIUM_HOURS || '24'),
});


