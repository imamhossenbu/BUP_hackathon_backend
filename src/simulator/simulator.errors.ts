import { HttpException, HttpStatus } from '@nestjs/common';

export interface ParsedSimulatorError {
  code: string;
  message: string;
  statusCode: number;
  raw?: unknown;
}

export class SimulatorException extends HttpException {
  public readonly code: string;

  constructor(code: string, message: string, statusCode: number = HttpStatus.BAD_GATEWAY) {
    super({ code, message, statusCode }, statusCode);
    this.code = code;
  }
}

export function parseSimulatorError(error: unknown): ParsedSimulatorError {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const axiosError = error as {
      response?: {
        status?: number;
        data?: unknown;
      };
      message?: string;
    };

    const status = axiosError.response?.status || HttpStatus.BAD_GATEWAY;
    const data = axiosError.response?.data as Record<string, unknown> | undefined;

    if (data) {
      // 1. Injected faults on /v1: {"error":{"code":"FAULT_INJECTED","message":"..."}}
      if (typeof data.error === 'object' && data.error !== null) {
        const errObj = data.error as { code?: string; message?: string };
        return {
          code: errObj.code || 'FAULT_INJECTED',
          message: errObj.message || 'Simulator injected fault',
          statusCode: status,
          raw: data,
        };
      }

      // 2. Allocation or stream errors: {"detail":{"code":"UPPER_SNAKE","message":"..."}}
      if (typeof data.detail === 'object' && data.detail !== null && !Array.isArray(data.detail)) {
        const detailObj = data.detail as { code?: string; message?: string };
        return {
          code: detailObj.code || 'SIMULATOR_ERROR',
          message: detailObj.message || 'Simulator operation error',
          statusCode: status,
          raw: data,
        };
      }

      // 3. Pydantic validation error: {"detail":[{"loc":[...],"msg":"...","type":"..."}]}
      if (Array.isArray(data.detail)) {
        return {
          code: 'VALIDATION_ERROR',
          message: JSON.stringify(data.detail),
          statusCode: status,
          raw: data,
        };
      }
    }

    return {
      code: 'HTTP_ERROR',
      message: axiosError.message || `Simulator returned HTTP ${status}`,
      statusCode: status,
      raw: data,
    };
  }

  const err = error as Error;
  return {
    code: 'NETWORK_ERROR',
    message: err?.message || 'Unknown network error communicating with simulator',
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
  };
}
