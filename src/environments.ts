import { ChainId, Env as DlnClientEnv } from '@debridge-finance/dln-client';

import { ChainEnvironment } from './config';

type Env = {
  WSS: string;
  defaultEvmAddresses: ChainEnvironment;
  chains: {
    [key in ChainId]?: ChainEnvironment;
  };
  environment?: DlnClientEnv;
};

const PRERELEASE_ENVIRONMENT_CODENAME_HANOI: Env = {
  WSS: 'wss://dln-ws-test.debridge.finance/ws',

  defaultEvmAddresses: {},
  environment: DlnClientEnv.Hanoi,

  chains: {
    [ChainId.Solana]: {
      deBridgeContract: 'Lima82j8YvHFYe8qa4kGgb3fvPFEnR3PoV6UyGUpHLq',
      pmmSrc: 'srch38nzfcgwJnfKE6xWD8vfNJtudazwisdcociAuQt',
      pmmDst: 'dsthjxvgzUiQYgoqSf7r5BbENqf2b34sSXkPvxuKS8d',
      solana: {
        debridgeSetting: 'settFZVDbqC9zBmV2ZCBfNMCtTzia2R7mVeR6ccK2nN',
      },
    },

    [ChainId.Polygon]: {
      deBridgeContract: '0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b',
      pmmSrc: '0x3c7010F5a2eCC2B56BeAE085B6528e492c8b36B6',
      pmmDst: '0x08F20E7Ace48dAe4806A96b88386E62b2C161054',
      evm: {
        forwarderContract: '0x4f824487f7C0AB5A6B8B8411E472eaf7dDef2BBd',
      },
    },

    [ChainId.BSC]: {
      deBridgeContract: '0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b',
      pmmSrc: '0x3c7010F5a2eCC2B56BeAE085B6528e492c8b36B6',
      pmmDst: '0x08F20E7Ace48dAe4806A96b88386E62b2C161054',
      evm: {
        forwarderContract: '0xce1705632Ced3A1d18Ed2b87ECe5B74526f59b8A',
      },
    },
  },
};

const PRERELEASE_ENVIRONMENT_CODENAME_MADRID: Env = {
  WSS: 'wss://dln-ws-madrid.debridge.finance/ws',

  defaultEvmAddresses: {},
  environment: DlnClientEnv.Madrid,

  chains: {
    [ChainId.Solana]: {
      deBridgeContract: 'Lima82j8YvHFYe8qa4kGgb3fvPFEnR3PoV6UyGUpHLq',
      pmmSrc: 'MADsq64WRCFuw4bqrZjtkVh5YiGcw6Jfy5cGbh6Gh8e',
      pmmDst: 'MADDfEEeW23M5owdXSXeBKAsb5zmT9oaLxDC4oLPfq7',
      solana: {
        debridgeSetting: 'settFZVDbqC9zBmV2ZCBfNMCtTzia2R7mVeR6ccK2nN',
      },
    },

    [ChainId.Polygon]: {
      deBridgeContract: '0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b',
      pmmSrc: '0x420cF3d24306b434E708cd5c7D6c82417C05c760',
      pmmDst: '0x67Ee8602DbeA6c858f10538101F3C5d4AC4e3eba',
      evm: {
        forwarderContract: '0x4f824487f7C0AB5A6B8B8411E472eaf7dDef2BBd',
      },
    },

    [ChainId.BSC]: {
      deBridgeContract: '0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b',
      pmmSrc: '0x420cF3d24306b434E708cd5c7D6c82417C05c760',
      pmmDst: '0x67Ee8602DbeA6c858f10538101F3C5d4AC4e3eba',
      evm: {
        forwarderContract: '0xce1705632Ced3A1d18Ed2b87ECe5B74526f59b8A',
      },
    },
  },
};

const PRODUCTION: Env = {
  WSS: 'wss://dln-ws.debridge.finance/ws',

  defaultEvmAddresses: {
    deBridgeContract: '0x43dE2d77BF8027e25dBD179B491e8d64f38398aA',
    pmmSrc: '0xeF4fB24aD0916217251F553c0596F8Edc630EB66',
    pmmDst: '0xE7351Fd770A37282b91D153Ee690B63579D6dd7f',
    evm: {
      forwarderContract: '0x663DC15D3C1aC63ff12E45Ab68FeA3F0a883C251',
    },
  },
  chains: {
    [ChainId.Solana]: {
      deBridgeContract: 'DEbrdGj3HsRsAzx6uH4MKyREKxVAfBydijLUF3ygsFfh',
      pmmSrc: 'src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4',
      pmmDst: 'dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo',
      solana: {
        debridgeSetting: 'DeSetTwWhjZq6Pz9Kfdo1KoS5NqtsM6G8ERbX4SSCSft',
      },
    },
    [ChainId.Base]: {
      deBridgeContract: '0xc1656B63D9EEBa6d114f6bE19565177893e5bCBF',
      pmmSrc: '0xeF4fB24aD0916217251F553c0596F8Edc630EB66',
      pmmDst: '0xE7351Fd770A37282b91D153Ee690B63579D6dd7f',
    },
  },
};

let CURRENT_ENVIRONMENT = PRODUCTION;

function setCurrentEnvironment(newEnvironment: Env) {
  CURRENT_ENVIRONMENT = newEnvironment;
}

function getCurrentEnvironment(): Env {
  return CURRENT_ENVIRONMENT;
}

export {
  setCurrentEnvironment,
  getCurrentEnvironment,
  PRODUCTION,
  PRERELEASE_ENVIRONMENT_CODENAME_MADRID,
  PRERELEASE_ENVIRONMENT_CODENAME_HANOI,
};
