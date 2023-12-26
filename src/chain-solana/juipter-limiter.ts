import { Jupiter } from '@debridge-finance/dln-client';

export class JupiterLimiter extends Jupiter.JupiterRouteLimiter {
  constructor(private excludedDexes: string[]) {
    super();
  }

  getExcludedDexes(): Promise<string[]> {
    return Promise.resolve(this.excludedDexes);
  }
}
