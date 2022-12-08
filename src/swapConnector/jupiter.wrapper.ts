// import { writeFileSync } from "fs";
// import markets from "./markets.json";
import { TOKEN_PROGRAM_ID } from '@debridge-finance/solana-utils';
import axios from 'axios';
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

import ALTs from './ammAlt.json';
import { Solana } from '@debridge-finance/dln-client';

type JupiterQuoteResponse = {
  data: Solana.Route[];
  timeTaken: number;
  contextSlot: number;
};

type JupiterSwapRequest = {
  route: Solana.Route;
  userPublicKey: string;
  wrapUnwrapSOL: boolean;
  feeAccount?: string;
  destinationWallet?: string;
};

type JupiterSwapResponse = {
  setupTransaction?: string;
  swapTransaction: string;
  cleanupTransaction?: string;
};

type RouteFilter = (route: Solana.Route) => boolean;

export class JupiterWrapper implements Solana.JupiterConnector {
  private QUOTE_API = 'https://quote-api.jup.ag/v3/quote';

  private SWAP_API = 'https://quote-api.jup.ag/v3/swap';

  private ALTMap: Map<string, string>;

  constructor(private routeFilter: RouteFilter = () => true) {
    this.ALTMap = new Map(Object.entries(ALTs as Record<string, string>));
  }

  async findExactOutRoutes(
    inputMint: PublicKey,
    outputMint: PublicKey,
    outputAmount: bigint,
    slippageBps?: number,
    maxInputAmount?: bigint,
  ) {
    const queryUrl = `${this.QUOTE_API}?inputMint=${this.fixToken(
      inputMint.toBase58(),
    )}&outputMint=${this.fixToken(
      outputMint.toBase58(),
    )}&swapMode=ExactOut&slippageBps=${
      slippageBps || 100
    }&amount=${outputAmount.toString()}`;
    console.log(queryUrl);
    const response = await axios.get<JupiterQuoteResponse>(queryUrl, {
      decompress: true,
      responseType: 'json',
    });
    if (response.status !== 200) {
      // TODO: add logs
      return null;
    }
    // else
    const routes = response.data.data;
    const blacklist = ['serum', ' + '];
    const filtered = routes.filter(this.routeFilter).filter(
      (iroute) =>
        iroute.marketInfos.find((market) => {
          // iterate over all route markets, try to find bad routes
          const label = market.label.toLowerCase();

          return blacklist.filter((item) => label.includes(item)).length !== 0; // check if market is in the blacklist
        }) === undefined,
    );
    // allowed routes not found
    if (filtered.length === 0) return null;
    const bestRoute = filtered[0];
    // input is too high
    if (maxInputAmount && BigInt(bestRoute.inAmount) > maxInputAmount)
      return null;

    return bestRoute;
  }

  async findExactInRoutes(
    inputMint: PublicKey,
    outputMint: PublicKey,
    inputAmount: bigint,
    slippageBps?: number,
    minOutputAmount?: bigint,
  ) {
    const queryUrl = `${this.QUOTE_API}?inputMint=${this.fixToken(
      inputMint.toBase58(),
    )}&outputMint=${this.fixToken(
      outputMint.toBase58(),
    )}&swapMode=ExactIn&slippageBps=${
      slippageBps || 100
    }&amount=${inputAmount.toString()}`;
    console.log(queryUrl);
    const response = await axios.get<JupiterQuoteResponse>(queryUrl, {
      decompress: true,
      responseType: 'json',
    });
    if (response.status !== 200) {
      // TODO: add logs
      return null;
    }
    // else
    const routes = response.data.data;
    const blacklist = ['serum', ' + '];
    const filtered = routes.filter(this.routeFilter).filter(
      (iroute) =>
        iroute.marketInfos.find((market) => {
          // iterate over all route markets, try to find bad routes
          const label = market.label.toLowerCase();

          return blacklist.filter((item) => label.includes(item)).length !== 0; // check if market is in the blacklist
        }) === undefined,
    );
    // allowed routes not found
    if (filtered.length === 0) return null;
    const bestRoute = filtered[0];
    // input is too high
    if (minOutputAmount && BigInt(bestRoute.outAmount) < minOutputAmount)
      return null;

    return bestRoute;
  }

  async routeToInstructions(
    route: Solana.Route,
    taker: PublicKey,
  ): Promise<[TransactionInstruction[], PublicKey[]]> {
    const requestData: JupiterSwapRequest = {
      route,
      userPublicKey: taker.toBase58(),
      wrapUnwrapSOL: true,
    };
    const response = await axios.post<JupiterSwapResponse>(
      `${this.SWAP_API}`,
      requestData,
      { decompress: true },
    );
    if (response.status !== 200) {
      throw new Error(response.statusText);
    }

    const instructions = [
      response.data.setupTransaction,
      response.data.swapTransaction,
      response.data.cleanupTransaction,
    ]
      .filter((serialized) => serialized !== undefined && serialized !== '')
      .map((serialized) => Transaction.from(Buffer.from(serialized!, 'base64')))
      .flatMap((tx) => tx.instructions);
    const computeBudgetProgramId =
      'ComputeBudget111111111111111111111111111111';

    const filtered = instructions.filter(
      (ix) =>
        ix.programId.toBase58() !== computeBudgetProgramId &&
        !(
          route.swapMode === 'ExactOut' &&
          ix.programId.equals(TOKEN_PROGRAM_ID) &&
          ix.data[0] === 9
        ), // close account
    );

    return [
      filtered,
      route.marketInfos
        .map((info) => this.ALTMap.get(info.id), this)
        .filter((alt) => alt !== undefined)
        .map((alt) => new PublicKey(alt!)),
    ];
  }

  private fixToken(token: string) {
    if (token === '11111111111111111111111111111111')
      return 'So11111111111111111111111111111111111111112';
    return token;
  }
}
