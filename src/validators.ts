import {ExecutorConfig, OrderValidator} from "./config";
import {ChainId, OrderData, PMMClient} from "@debridge-finance/pmm-client";
import {helpers} from "@debridge-finance/solana-utils";
import Web3 from "web3";
import BigNumber from "bignumber.js";
import logger from "loglevel";


/**
 * checks if maker is one of allowed todo
 */
export function isValidMaker(addresses: string[]): OrderValidator {
  return async (order: OrderData, pmmClient: PMMClient, config: ExecutorConfig) => {
    const result = addresses.map(address => address.toLowerCase()).includes(helpers.bufferToHex(Buffer.from(order.maker)));
    logger.log(`isValidMaker result=${result}`);

    return result;//todo fix
  };
}

/**
 * checks if srcChain is defined (we need to know its beneficiary)
 */
export function srcChainIsRegistered(chains: ChainId[]): OrderValidator {
    return async (order: OrderData, pmmClient: PMMClient) => {
      const result = chains.includes(order.give.chainId);
      logger.log(`srcChainIsRegistered result=${result}`);

      return result;
    };
}


/**
 * checks if order profitability is at least as given (comparing dollar equiv of give and take amounts)
 */
 export function orderIsProfitable(profitabilityMinBps: number): OrderValidator {
    return async (order: OrderData, pmmClient: PMMClient, config: ExecutorConfig) => {
      let giveWeb3;
      if (order.give.chainId !== ChainId.Solana) {
        giveWeb3 = new Web3(config.fulfillableChains!.find(chainConfig => chainConfig.chain === order.give.chainId)!.chainRpc);
      }

      let takeWeb3;
      if (order.take.chainId !== ChainId.Solana) {
        takeWeb3 = new Web3(config.fulfillableChains!.find(chainConfig => chainConfig.chain === order.take.chainId)!.chainRpc);
      }

      const giveAddress = helpers.bufferToHex(Buffer.from(order.give.tokenAddress));
      const takeAddress = helpers.bufferToHex(Buffer.from(order.take.tokenAddress));

      logger.log(`orderIsProfitable giveAddress=${giveAddress}`);
      logger.log(`orderIsProfitable takeAddress=${takeAddress}`);

      const [givePrice, takePrice, giveDecimals, takeDecimals] = await Promise.all([
        config.priceTokenService!.getPrice(order.give.chainId, giveAddress),
        config.priceTokenService!.getPrice(order.take.chainId, takeAddress),
        pmmClient.getDecimals(order.give.chainId, giveAddress, giveWeb3),
        pmmClient.getDecimals(order.take.chainId, takeAddress, takeWeb3),
      ]);

      logger.log(`orderIsProfitable givePrice=${givePrice}`);
      logger.log(`orderIsProfitable takePrice=${takePrice}`);
      logger.log(`orderIsProfitable giveDecimals=${giveDecimals}`);
      logger.log(`orderIsProfitable takeDecimals=${takeDecimals}`);



      const giveUsdAmount = BigNumber(givePrice).
        multipliedBy(order.give.amount.toString()).
        dividedBy(new BigNumber(10).pow(giveDecimals));
      logger.log(`orderIsProfitable giveUsdAmount=${giveUsdAmount}`);

      const takeUsdAmount = BigNumber(takePrice).
        multipliedBy(order.take.amount.toString()).
        dividedBy(new BigNumber(10).pow(takeDecimals));
      logger.log(`orderIsProfitable takeDecimals=${takeDecimals}`);

      const profitability = takeUsdAmount.multipliedBy(profitabilityMinBps).div(100 ** 2);
      logger.log(`orderIsProfitable profitability=${profitability}`);

      const result = profitability.lte(giveUsdAmount.div(takeUsdAmount));
      logger.log(`orderIsProfitable result=${result}`);

      return result;
    };
}


/**
 * checks if giveAmount's dollar cost is within range
 */
 export function giveAmountDollarEquiv(minDollarEquiv: number, maxDollarEquiv: number): OrderValidator {
    return async (order: OrderData, pmmClient: PMMClient, config: ExecutorConfig) => {
      let giveWeb3;
      if (order.give.chainId !== ChainId.Solana) {
        giveWeb3 = new Web3(config.fulfillableChains!.find(chainConfig => chainConfig.chain === order.give.chainId)!.chainRpc);
      }
      const giveAddress = helpers.bufferToHex(Buffer.from(order.give.tokenAddress));
      logger.log(`giveAmountDollarEquiv giveAddress=${giveAddress}`);

      const [givePrice, giveDecimals] = await Promise.all([
        config.priceTokenService!.getPrice(order.give.chainId, giveAddress),
        pmmClient.getDecimals(order.give.chainId, giveAddress, giveWeb3),
      ]);
      logger.log(`giveAmountDollarEquiv givePrice=${givePrice}`);
      logger.log(`giveAmountDollarEquiv giveDecimals=${giveDecimals}`);

      const giveUsdAmount = BigNumber(givePrice)
        .multipliedBy(order.give.amount.toString())
        .dividedBy(new BigNumber(10).pow(giveDecimals)).toNumber();
      logger.log(`giveAmountDollarEquiv giveUsdAmount=${giveUsdAmount}`);

      const result = minDollarEquiv <= giveUsdAmount && giveUsdAmount <= maxDollarEquiv
      logger.log(`giveAmountDollarEquiv result=${result}`);

      return result;
    };
}


/**
 * checks if takeAmount's dollar cost is within range
 */
 export function takeAmountDollarEquiv(minDollarEquiv: number, maxDollarEquiv: number): OrderValidator {
    return async (order: OrderData, pmmClient: PMMClient, config: ExecutorConfig) => {
      const takeAddress = helpers.bufferToHex(Buffer.from(order.take.tokenAddress));
      logger.log(`takeAmountDollarEquiv takeAddress=${takeAddress}`);

      let takeWeb3;
      if (order.take.chainId !== ChainId.Solana) {
        takeWeb3 = new Web3(config.fulfillableChains!.find(chainConfig => chainConfig.chain === order.take.chainId)!.chainRpc);
      }
      const [takePrice, takeDecimals] = await Promise.all([
        config.priceTokenService!.getPrice(order.take.chainId, takeAddress),
        pmmClient.getDecimals(order.take.chainId, takeAddress, takeWeb3),
      ]);
      logger.log(`takeAmountDollarEquiv takePrice=${takePrice}`);
      logger.log(`takeAmountDollarEquiv takeDecimals=${takeDecimals}`);

      const takeUsdAmount = BigNumber(takePrice)
        .multipliedBy(order.take.amount.toString())
        .dividedBy(new BigNumber(10).pow(takeDecimals)).toNumber();
      logger.log(`takeAmountDollarEquiv takeUsdAmount=${takeUsdAmount}`);

      const result = minDollarEquiv <= takeUsdAmount && takeUsdAmount <= maxDollarEquiv;
      logger.log(`takeAmountDollarEquiv result=${result}`);

      return result;
    };
}
