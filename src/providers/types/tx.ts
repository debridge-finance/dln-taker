export class Tx {
  data: string;
  to: string;
  value: number ;

  from?: string ;
  gasPrice?: string ;
  gasLimit?: number ;
  nonce?: number ;
}
