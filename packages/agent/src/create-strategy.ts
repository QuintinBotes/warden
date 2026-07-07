import { ProviderError, type AgentStrategy, type StrategyName } from '@warden/core';
import { ExploratoryStrategy } from './exploratory-strategy';
import { GenerativeStrategy } from './generative-strategy';
import { HealerStrategy } from './healer-strategy';

/** Factory for the three V1 agent strategies. */
export function createStrategy(name: StrategyName): AgentStrategy {
  switch (name) {
    case 'exploratory':
      return new ExploratoryStrategy();
    case 'generative':
      return new GenerativeStrategy();
    case 'healer':
      return new HealerStrategy();
    default:
      throw new ProviderError(`Unknown strategy "${String(name)}".`);
  }
}
