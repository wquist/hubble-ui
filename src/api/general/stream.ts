import { Message as PBMessage } from 'google-protobuf';
import { Error as GRPCError, Status as GRPCStatus } from 'grpc-web';
import { ErrorWrapper } from '~/api/grpc/error';

export enum GeneralStreamEventKind {
  Data = 'data',
  Status = 'status',
  Error = 'error',
  End = 'end',
}

export type GeneralStreamEvents = {
  [GeneralStreamEventKind.Data]: (data: PBMessage) => void;
  [GeneralStreamEventKind.Status]: (status: GRPCStatus) => void;
  [GeneralStreamEventKind.Error]: (_: ErrorWrapper) => void;
  [GeneralStreamEventKind.End]: () => void;
};
