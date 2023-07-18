// from: https://github.com/Arachnid/deterministic-deployment-proxy
import { BigNumber, BigNumberish, ethers, Signer } from 'ethers'
import { arrayify, hexConcat, hexlify, hexZeroPad, keccak256 } from 'ethers/lib/utils'
import { Provider } from '@ethersproject/providers'
import { TransactionRequest } from '@ethersproject/abstract-provider'

export class Create2Factory {
  factoryDeployed = false

  // from: https://github.com/Arachnid/deterministic-deployment-proxy
  static contractAddress = '0x1e8fda220759f2b4e3fa68b875c73e21fdc737ec'
  static readonly factoryTx = '0xf8a78085e8d4a51000830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf382f4f6a03b907605c26842388dafcf7ed3076a9e3e493f99ef2920fa0a1b16e881b22c48a0283eaf454fcf77f65e220c0c1a836105cf6a562cebca4a22517675c058fa7c76'
  static readonly factoryDeployer = '0x538e86c294cd4d7870790B51Ab063B860Ca9cAEE'
  static readonly deploymentGasPrice = 1000000000000;
  static readonly deploymentGasLimit = 100000
  static readonly factoryDeploymentFee = (Create2Factory.deploymentGasPrice * Create2Factory.deploymentGasLimit).toString()

  constructor (readonly provider: Provider,
    readonly signer = (provider as ethers.providers.JsonRpcProvider).getSigner()) {
  }

  /**
   * deploy a contract using our deterministic deployer.
   * The deployer is deployed (unless it is already deployed)
   * NOTE: this transaction will fail if already deployed. use getDeployedAddress to check it first.
   * @param initCode delpoyment code. can be a hex string or factory.getDeploymentTransaction(..)
   * @param salt specific salt for deployment
   * @param gasLimit gas limit or 'estimate' to use estimateGas. by default, calculate gas based on data size.
   */
  async deploy (initCode: string | TransactionRequest, salt: BigNumberish = 0, gasLimit?: BigNumberish | 'estimate'): Promise<string> {
    await this.deployFactory()
    if (typeof initCode !== 'string') {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      initCode = (initCode as TransactionRequest).data!.toString()
    }

    const addr = Create2Factory.getDeployedAddress(initCode, salt)
    if (await this.provider.getCode(addr).then(code => code.length) > 2) {
      return addr
    }

    const deployTx = {
      to: Create2Factory.contractAddress,
      data: this.getDeployTransactionCallData(initCode, salt)
    }
    if (gasLimit === 'estimate') {
      gasLimit = await this.signer.estimateGas(deployTx)
    }

    // manual estimation (its bit larger: we don't know actual deployed code size)
    if (gasLimit === undefined) {
      gasLimit = arrayify(initCode)
        .map(x => x === 0 ? 4 : 16)
        .reduce((sum, x) => sum + x) +
        200 * initCode.length / 2 + // actual is usually somewhat smaller (only deposited code, not entire constructor)
        6 * Math.ceil(initCode.length / 64) + // hash price. very minor compared to deposit costs
        32000 +
        21000

      // deployer requires some extra gas
      gasLimit = Math.floor(gasLimit * 64 / 63)
    }

    const ret = await this.signer.sendTransaction({ ...deployTx, gasLimit })
    await ret.wait()
    if (await this.provider.getCode(addr).then(code => code.length) === 2) {
      throw new Error('failed to deploy')
    }
    return addr
  }

  getDeployTransactionCallData (initCode: string, salt: BigNumberish = 0): string {
    const saltBytes32 = hexZeroPad(hexlify(salt), 32)
    return hexConcat([
      saltBytes32,
      initCode
    ])
  }

  /**
   * return the deployed address of this code.
   * (the deployed address to be used by deploy()
   * @param initCode
   * @param salt
   */
  static getDeployedAddress (initCode: string, salt: BigNumberish): string {
    const saltBytes32 = hexZeroPad(hexlify(salt), 32)
    return '0x' + keccak256(hexConcat([
      '0xff',
      Create2Factory.contractAddress,
      saltBytes32,
      keccak256(initCode)
    ])).slice(-40)
  }

  // deploy the factory, if not already deployed.
  async deployFactory (signer?: Signer): Promise<void> {
    if (await this._isFactoryDeployed()) {
      return
    }

    let userAddr = await this.signer.getAddress();
    
    // build the transaction
    const unsignedTx = {
      from: userAddr,
      value: 0,
      gasLimit: 100000,
      data: "0x604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3"
    };

    let tx = await this.signer.sendTransaction(unsignedTx);
    let receipt = await tx.wait();

    Create2Factory.contractAddress = receipt.contractAddress;
    console.log("Create2Factory Address: ", Create2Factory.contractAddress);

    if (!await this._isFactoryDeployed()) {
      throw new Error('fatal: failed to deploy deterministic deployer')
    }
  }

  async _isFactoryDeployed (): Promise<boolean> {
    if (!this.factoryDeployed) {
      const deployed = await this.provider.getCode(Create2Factory.contractAddress)
      if (deployed.length > 2) {
        this.factoryDeployed = true
      }
    }
    return this.factoryDeployed
  }
}
