import { mnemonicToSeedSync } from "@scure/bip39"
import { HDKey } from "@scure/bip32"
import { getPolkadotSigner, type PolkadotSigner } from "polkadot-api/signer"
import { Binary, createClient } from "polkadot-api"
import { getWsProvider } from "polkadot-api/ws-provider/web"
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat"
import { myth } from "@polkadot-api/descriptors"
import { secp256k1 } from "@noble/curves/secp256k1"
import { keccak_256 } from "@noble/hashes/sha3"

function getEvmPolkadotSigner(mnemonic: string): PolkadotSigner {
  const seed = mnemonicToSeedSync(mnemonic, "")
  const keyPair = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0")
  const publicAddress = keccak_256(
    secp256k1.getPublicKey(keyPair.privateKey!, false).slice(1),
  ).slice(-20)

  const sign = (data: Uint8Array) => {
    const signature = secp256k1.sign(keccak_256(data), keyPair.privateKey!)
    const signedBytes = signature.toCompactRawBytes()
    const len = signedBytes.length
    const result = new Uint8Array(len + 1)
    result.set(signedBytes)
    result[len] = signature.recovery
    return result
  }

  return getPolkadotSigner(publicAddress, "Ecdsa", sign)
}

const yourSeedPhrase = ""
const signer = getEvmPolkadotSigner(yourSeedPhrase)

const client = createClient(
  withPolkadotSdkCompat(getWsProvider("wss://moonbase-rpc.dwellir.com")),
)
const api = client.getTypedApi(myth)

const tx = api.tx.System.remark({
  remark: Binary.fromText(
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas laoreet velit eu sollicitudin scelerisque. Quisque non bibendum odio. Donec vehicula tortor eget ornare tincidunt. Nulla hendrerit, risus tempor accumsan placerat, dui justo vestibulum augue, ut euismod nibh sem ut arcu viverra fusce.",
  ),
})

console.log(await tx.getEstimatedFees(signer.publicKey))
tx.signSubmitAndWatch(signer).subscribe(console.log, console.error)
