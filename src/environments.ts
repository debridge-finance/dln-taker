
const PRERELEASE_ENVIRONMENT_CODENAME_LIMA = {
    WSS: 'wss://lima-pmm-ws.debridge.io/ws',

    Solana: {
        deBridgeContract: "Lima82j8YvHFYe8qa4kGgb3fvPFEnR3PoV6UyGUpHLq",
        pmmSrc: "src3au6NwAGF8ntnJKdkcUJy3aQg1qHoJMCwyunDk9j",
        pmmDst: "dst3kkK8VJ1oU7QstWcKkRSU6s1YeopZxEJp9XfxqP7",
        solana: {
            debridgeSetting: "settFZVDbqC9zBmV2ZCBfNMCtTzia2R7mVeR6ccK2nN"
        }
    },

    Polygon: {
        deBridgeContract: "0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b",
        pmmSrc: "0x81BD33D37941F5912C9FB74c8F00FB8d2CaCa327",
        pmmDst: "0xceD226Cbc7B4473c7578E3b392427d09448f24Ae",
        evm: {
          forwarderContract: '0x4f824487f7C0AB5A6B8B8411E472eaf7dDef2BBd'
        }
    },

    BNB: {
        deBridgeContract: "0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b",
        pmmSrc: "0x81BD33D37941F5912C9FB74c8F00FB8d2CaCa327",
        pmmDst: "0xceD226Cbc7B4473c7578E3b392427d09448f24Ae",
        evm: {
          forwarderContract: '0xce1705632Ced3A1d18Ed2b87ECe5B74526f59b8A'
        }
    }
}

const CURRENT_ENVIRONMENT = PRERELEASE_ENVIRONMENT_CODENAME_LIMA;

export {
    CURRENT_ENVIRONMENT,
    PRERELEASE_ENVIRONMENT_CODENAME_LIMA
}
