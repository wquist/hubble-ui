import { Error as GrpcError, StatusCode } from 'grpc-web';

export class ErrorWrapper {
  private error: GrpcError;

  public static fromGrpc(err: GrpcError) {
    return new ErrorWrapper(err);
  }

  constructor(err: GrpcError) {
    this.error = err;
  }

  public get isAborted(): boolean {
    return this.error.code === StatusCode.ABORTED;
  }

  public get isAlreadyExists(): boolean {
    return this.error.code === StatusCode.ALREADY_EXISTS;
  }

  public get isCanceled(): boolean {
    return this.error.code === StatusCode.CANCELLED;
  }

  public get isDataLoss(): boolean {
    return this.error.code === StatusCode.DATA_LOSS;
  }

  public get isDeadlineExceeded(): boolean {
    return this.error.code === StatusCode.DEADLINE_EXCEEDED;
  }

  public get isFailedPrecondition(): boolean {
    return this.error.code === StatusCode.FAILED_PRECONDITION;
  }

  public get isInternal(): boolean {
    return this.error.code === StatusCode.INTERNAL;
  }

  public get isInvalidArgument(): boolean {
    return this.error.code === StatusCode.INVALID_ARGUMENT;
  }

  public get isNotFound(): boolean {
    return this.error.code === StatusCode.NOT_FOUND;
  }

  public get isOk(): boolean {
    return this.error.code === StatusCode.OK;
  }

  public get isOutOfRange(): boolean {
    return this.error.code === StatusCode.OUT_OF_RANGE;
  }

  public get isPermissionDenied(): boolean {
    return this.error.code === StatusCode.PERMISSION_DENIED;
  }

  public get isResourceExhausted(): boolean {
    return this.error.code === StatusCode.RESOURCE_EXHAUSTED;
  }

  public get isUnauthenticated(): boolean {
    return this.error.code === StatusCode.UNAUTHENTICATED;
  }

  public get isUnavailable(): boolean {
    return this.error.code === StatusCode.UNAVAILABLE;
  }

  public get isUnimplemented(): boolean {
    return this.error.code === StatusCode.UNIMPLEMENTED;
  }

  public get isUnknown(): boolean {
    return this.error.code === StatusCode.UNKNOWN;
  }

  public get isRetriable(): boolean {
    return (
      this.isUnavailable ||
      this.isCanceled ||
      this.isInternal ||
      this.isAborted ||
      this.isUnknown
    );
  }

  public get message(): string {
    return this.error.message;
  }

  public get code(): number {
    return this.error.code;
  }
}
