import { SlippageOverrideService } from "../src/services/SlippageOverrideService";
import {ChainId, Logger, PMMClient, tokenStringToBuffer} from "@debridge-finance/dln-client";
import assert from "assert";
import BigNumber from "bignumber.js";

describe('SlippageOverrideService', () => {
  const context = {
    logger: { verbose: () => {} } as unknown as Logger,
    web3: undefined,
  };
  const client = {} as unknown as PMMClient;

  it('should use global slippage', () => {
    const func = new SlippageOverrideService({
      slippageBps: 10,
      perChain: {
        [ChainId.BSC]: {
          slippageBps: 5,
        }
      }
    }, {}).createSlippageOverloaderFunc();
    const chain = ChainId.Polygon;
    const calculatedSlippage = func(client,
      chain,
      tokenStringToBuffer(chain, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'), //usdc
      new BigNumber(0),
      tokenStringToBuffer(chain, '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'), //wmatic
      new BigNumber(0),
      0,
      0,
      context);
    assert.equal(calculatedSlippage, 10);
  });

  it('use global chain slippage', () => {
    const func = new SlippageOverrideService({
      slippageBps: 10,
      perChain: {
        [ChainId.Polygon]: {
          slippageBps: 5,
          perTokenIn: {
            '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': { //wmatic
              slippageBps: 7
            }
          }
        }
      }
    }, {}).createSlippageOverloaderFunc();
    const chain = ChainId.Polygon;
    const calculatedSlippage = func(client,
      chain,
      tokenStringToBuffer(chain, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'), //usdc
      new BigNumber(0),
      tokenStringToBuffer(chain, '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'), //wmatic
      new BigNumber(0),
      0,
      0,
      context,)
    assert.equal(calculatedSlippage, 5);
  });

  it('use global tokenIn slippage', () => {
    const func = new SlippageOverrideService({
      slippageBps: 10,
      perChain: {
        [ChainId.Polygon]: {
          slippageBps: 5,
          perTokenIn: {
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { //usdc
              slippageBps: 7
            }
          }
        }
      }
    }, {}).createSlippageOverloaderFunc();
    const chain = ChainId.Polygon;
    const calculatedSlippage = func(client,
      chain,
      tokenStringToBuffer(chain, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'), //usdc
      new BigNumber(0),
      tokenStringToBuffer(chain, '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'), //wmatic
      new BigNumber(0),
      0,
      0,
      context,)
    assert.equal(calculatedSlippage, 7);
  });

  it('use from pair tokenIn-tokenOut slippage', () => {
    const func = new SlippageOverrideService({
      slippageBps: 10,
      perChain: {
        [ChainId.Polygon]: {
          slippageBps: 5,
          perTokenIn: {
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { //usdc
              slippageBps: 7,
              overrides: [
                { slippageBps: 11, tokensOut: ['0x0d500b1d8e8ef31e21c99d1db9a6414d3adf1275'] },
                { slippageBps: 1, tokensOut: ['0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'] } //wmatic
              ]
            }
          }
        }
      }
    }, {}).createSlippageOverloaderFunc();
    const chain = ChainId.Polygon;
    const calculatedSlippage = func(client,
      chain,
      tokenStringToBuffer(chain, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'), //usdc
      new BigNumber(0),
      tokenStringToBuffer(chain, '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'), //wmatic
      new BigNumber(0),
      0,
      0,
      context,)
    assert.equal(calculatedSlippage, 1);
  });

  it('use base slippage configuration', () => {
    const func = new SlippageOverrideService({}, {
      slippageBps: 12,
    }).createSlippageOverloaderFunc();
    const chain = ChainId.Polygon;
    const calculatedSlippage = func(client,
      chain,
      tokenStringToBuffer(chain, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'), //usdc
      new BigNumber(0),
      tokenStringToBuffer(chain, '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'), //wmatic
      new BigNumber(0),
      0,
      0,
      context,)
    assert.equal(calculatedSlippage, 12);
  });
});