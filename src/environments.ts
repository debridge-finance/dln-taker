import { ChainId } from "@debridge-finance/dln-client";

import { ChainEnvironment } from "./config";

type Env = {
  WSS: string;
  defaultEvmAddresses: ChainEnvironment;
  chains: {
    [key in ChainId]?: ChainEnvironment;
  };
};

const PRERELEASE_ENVIRONMENT_CODENAME_LIMA: Env = {
  WSS: "wss://lima-pmm-ws.debridge.io/ws",

  defaultEvmAddresses: {},

  chains: {
    [ChainId.Solana]: {
      deBridgeContract: "Lima82j8YvHFYe8qa4kGgb3fvPFEnR3PoV6UyGUpHLq",
      pmmSrc: "src3au6NwAGF8ntnJKdkcUJy3aQg1qHoJMCwyunDk9j",
      pmmDst: "dst3kkK8VJ1oU7QstWcKkRSU6s1YeopZxEJp9XfxqP7",
      solana: {
        debridgeSetting: "settFZVDbqC9zBmV2ZCBfNMCtTzia2R7mVeR6ccK2nN",
      },
    },

    [ChainId.Polygon]: {
      deBridgeContract: "0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b",
      pmmSrc: "0x81BD33D37941F5912C9FB74c8F00FB8d2CaCa327",
      pmmDst: "0xceD226Cbc7B4473c7578E3b392427d09448f24Ae",
      evm: {
        forwarderContract: "0x4f824487f7C0AB5A6B8B8411E472eaf7dDef2BBd",
      },
    },

    [ChainId.BSC]: {
      deBridgeContract: "0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b",
      pmmSrc: "0x81BD33D37941F5912C9FB74c8F00FB8d2CaCa327",
      pmmDst: "0xceD226Cbc7B4473c7578E3b392427d09448f24Ae",
      evm: {
        forwarderContract: "0xce1705632Ced3A1d18Ed2b87ECe5B74526f59b8A",
      },
    },
  },
};

const PRODUCTION: Env = {
  WSS: "wss://dln-ws.debridge.finance/ws",

  defaultEvmAddresses: {
    deBridgeContract: "0x43dE2d77BF8027e25dBD179B491e8d64f38398aA",
    pmmSrc: "0xeF4fB24aD0916217251F553c0596F8Edc630EB66",
    pmmDst: "0xE7351Fd770A37282b91D153Ee690B63579D6dd7f",
    evm: {
      forwarderContract: '0xc31fc94F3Fd088eE53ac915D6e8a14fF25a23C47'
    },
  },

  chains: {
    [ChainId.Solana]: {
      deBridgeContract: "Lima82j8YvHFYe8qa4kGgb3fvPFEnR3PoV6UyGUpHLq",
      pmmSrc: "src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4",
      pmmDst: "dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo",
      solana: {
        debridgeSetting: "settFZVDbqC9zBmV2ZCBfNMCtTzia2R7mVeR6ccK2nN",
      },
    },
  },
};

const CURRENT_ENVIRONMENT = PRODUCTION;

export {
  CURRENT_ENVIRONMENT,
  PRODUCTION,
  PRERELEASE_ENVIRONMENT_CODENAME_LIMA,
};
