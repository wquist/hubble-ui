import _ from 'lodash';
import retry from 'async-retry';

import { API } from '~/api/general';
import * as mockData from '~/api/__mocks__/data';
import { GeneralStreamEventKind } from '~/api/general/stream';
import { ErrorWrapper } from '~/api/grpc/error';

import { HubbleFlow } from '~/domain/hubble';
import { Filters, filterFlow } from '~/domain/filtering';
import { Flow } from '~/domain/flows';
import { flowFromRelay } from '~/domain/helpers';
import { StateChange, setupDebugProp } from '~/domain/misc';

import { EventEmitter } from '~/utils/emitter';
import {
  EventParamsSet,
  EventKind as EventStreamEventKind,
  NamespaceChange,
  ServiceChange,
  ServiceLinkChange,
  IEventStream,
  EventParams,
} from '~/api/general/event-stream';

import { Store, StoreFrame } from '~/store';

export enum EventKind {
  Connected = 'connected',
  StreamError = 'stream-error',
  StreamEnd = 'stream-end',
  FlowsDiff = 'flows-diff',
  StoreMocked = 'store-mocked',
  NamespaceAdded = 'namespace-added',
}

type Events = {
  [EventKind.Connected]: () => void;
  [EventKind.StreamError]: (err: StreamError) => void;
  [EventKind.StreamEnd]: () => void;
  [EventKind.FlowsDiff]: (frame: StoreFrame, diff: number) => void;
  [EventKind.StoreMocked]: () => void;
  [EventKind.NamespaceAdded]: (namespace: string) => void;
};

export type RetryCallback = (attempt: number, success: boolean) => void;

export enum StreamKind {
  Initial = 'initial',
  Main = 'main',
  Secondary = 'secondary',
}

export interface StreamError {
  streamKind: StreamKind;
  error: ErrorWrapper;
  stream: IEventStream;
}

interface StreamDescriptor {
  stream: IEventStream;
  eventParams: EventParams;
  frame?: StoreFrame;
  filters?: Filters;
}

export class DataManager extends EventEmitter<Events> {
  private api: API;
  private store: Store;

  private initialStream: StreamDescriptor | null = null;
  private mainStream: StreamDescriptor | null = null;
  private filteringStream: StreamDescriptor | null = null;

  constructor(api: API, store: Store) {
    super();

    this.api = api;
    this.store = store;

    setupDebugProp({
      stopAllStreams: () => {
        this.stopAllStreams();
      },
    });
  }

  public setupMock() {
    this.store.controls.setCurrentNamespace(mockData.selectedNamespace);
    this.store.controls.setCrossNamespaceActivity(true);
    this.store.setup(mockData);

    this.emit(EventKind.StoreMocked);
  }

  public setupMainStream(namespace: string) {
    const store = this.store;
    const eventParams = EventParamsSet.All;
    const filters = store.controls.mainFilters.clone().setNamespace(namespace);

    const frame = store.mainFrame;
    const stream = this.api.v1.getEventStream(eventParams, filters);

    this.setupMainStreamHandlers(stream, frame);
    this.mainStream = { stream, filters, eventParams, frame };
  }

  private setupMainStreamHandlers(stream: IEventStream, frame: StoreFrame) {
    this.setupGeneralEventHandlers(stream, StreamKind.Main);
    this.setupNamespaceEventHandlers(stream);
    this.setupServicesEventHandlers(stream, frame);
  }

  public dropMainStream() {
    if (this.mainStream == null) return;

    this.mainStream.stream.stop();
    this.offAllStreamEvents(this.mainStream.stream);
    this.mainStream = null;
  }

  public setupFilteringFrame(namespace: string) {
    const store = this.store;
    const filters = store.controls.filters.clone().setNamespace(namespace);
    const eventParams = EventParamsSet.All;
    const frame = store.currentFrame.filter(filters);
    store.pushFrame(frame);

    const stream = this.api.v1.getEventStream(eventParams, filters);
    this.setupFilteringStreamHandlers(stream, frame, filters);

    this.filteringStream = { stream, filters, eventParams, frame };
  }

  private setupFilteringStreamHandlers(
    stream: IEventStream,
    frame: StoreFrame,
    filters: Filters,
  ) {
    this.setupGeneralEventHandlers(stream, StreamKind.Secondary);
    this.setupNamespaceEventHandlers(stream);
    this.setupServicesEventHandlers(stream, frame, filters);
  }

  public dropFilteringFrame() {
    if (this.filteringStream == null) return;

    this.filteringStream.stream.stop();
    this.offAllStreamEvents(this.filteringStream.stream);
    this.filteringStream = null;
    this.store.squashFrames();
  }

  public setupInitialStream() {
    const eventParams = EventParamsSet.Namespaces;
    const stream = this.api.v1.getEventStream(eventParams);

    this.setupInitialStreamHandlers(stream);
    this.initialStream = { stream, eventParams };
  }

  private setupInitialStreamHandlers(stream: IEventStream) {
    this.setupGeneralEventHandlers(stream, StreamKind.Initial);
    this.setupNamespaceEventHandlers(stream);
  }

  public dropInitialStream() {
    if (this.initialStream == null) return;

    this.initialStream.stream.stop();
    this.offAllStreamEvents(this.initialStream.stream);
    this.initialStream = null;
  }

  public resetNamespace(namespace: string) {
    if (this.mainStream) {
      this.dropMainStream();
      this.store.flush();
    }

    this.dropInitialStream();
    this.setupMainStream(namespace);
  }

  public retryError(err: StreamError, afterAttemptCb: RetryCallback) {
    if (!err.error.isRetriable) return;
    this.offAllStreamEvents(err.stream);
    let attempt = 1;
    console.log('in retryError');

    retry(
      stop => {
        console.log('in retry callback');
        let stream: IEventStream | null = null;
        if (err.streamKind === StreamKind.Initial && this.initialStream) {
          const { eventParams, filters } = this.initialStream;
          const newStream = this.api.v1.getEventStream(eventParams, filters);

          this.setupInitialStreamHandlers(newStream);
          this.initialStream.stream = newStream;
          stream = newStream;
        }

        if (err.streamKind === StreamKind.Main && this.mainStream) {
          const { eventParams, filters, frame } = this.mainStream;
          const newStream = this.api.v1.getEventStream(eventParams, filters);

          this.setupMainStreamHandlers(newStream, frame!);
          this.mainStream.stream = newStream;
          stream = newStream;
        }

        if (err.streamKind === StreamKind.Secondary && this.filteringStream) {
          const { eventParams, filters, frame } = this.filteringStream;
          const newStream = this.api.v1.getEventStream(eventParams, filters);

          this.setupFilteringStreamHandlers(newStream, frame!, filters!);
          this.filteringStream.stream = newStream;
          stream = newStream;
        }

        if (stream == null) {
          stop(new Error('null stream (unreachable)'));
          return;
        }

        return new Promise((resolve, reject) => {
          stream!.once(GeneralStreamEventKind.Data, () => {
            afterAttemptCb(attempt, true);
            resolve();
          });

          stream!.once(GeneralStreamEventKind.Error, () => {
            afterAttemptCb(attempt, false);
            attempt += 1;
            reject();
          });
        });
      },
      {
        // retries: Infinity,
        forever: true,
        factor: 1.6,
        minTimeout: 1000,
        maxTimeout: 5000,
      },
    );
  }

  private setupNamespaceEventHandlers(stream: IEventStream) {
    stream.on(EventStreamEventKind.Namespace, (nsChange: NamespaceChange) => {
      this.store.applyNamespaceChange(nsChange.name, nsChange.change);

      if (nsChange.change === StateChange.Added) {
        this.emit(EventKind.NamespaceAdded, nsChange.name);
      }
    });
  }

  private setupServicesEventHandlers(
    stream: IEventStream,
    frame: StoreFrame,
    filters?: Filters,
  ) {
    stream.on(EventStreamEventKind.Service, (svcChange: ServiceChange) => {
      frame.applyServiceChange(svcChange.service, svcChange.change);
    });

    stream.on(EventStreamEventKind.Flows, (hubbleFlows: HubbleFlow[]) => {
      const preparedFlows = hubbleFlows
        .reverse()
        .reduce<Flow[]>((acc, hubbleFlow) => {
          const flow = flowFromRelay(hubbleFlow);
          if (filters == null || filterFlow(flow, filters)) acc.push(flow);
          return acc;
        }, []);

      const { flowsDiffCount } = frame.addFlows(preparedFlows);

      this.emit(EventKind.FlowsDiff, frame, flowsDiffCount);
    });

    stream.on(EventStreamEventKind.ServiceLink, (link: ServiceLinkChange) => {
      frame.applyServiceLinkChange(link.serviceLink, link.change);
    });
  }

  private setupGeneralEventHandlers(
    stream: IEventStream,
    streamKind: StreamKind,
  ) {
    stream.once(GeneralStreamEventKind.Data, () => {
      this.emit(EventKind.Connected);
    });

    stream.on(GeneralStreamEventKind.Error, error => {
      this.emit(EventKind.StreamError, { stream, streamKind, error });
    });

    stream.on(GeneralStreamEventKind.End, () => {
      this.emit(EventKind.StreamEnd);
    });
  }

  private offAllStreamEvents(stream: IEventStream) {
    stream.offAllEvents();
  }

  private stopAllStreams() {
    if (this.mainStream) {
      this.mainStream.stream.stop();
      this.offAllStreamEvents(this.mainStream.stream);
    }

    if (this.initialStream) {
      this.initialStream.stream.stop();
      this.offAllStreamEvents(this.initialStream.stream);
    }

    if (this.filteringStream) {
      this.filteringStream.stream.stop();
      this.offAllStreamEvents(this.filteringStream.stream);
    }
  }

  public get flowsDelay(): number | undefined {
    return this.mainStream?.stream.flowsDelay;
  }

  public get currentNamespace(): string | undefined {
    return this.mainStream?.filters?.namespace || undefined;
  }

  public get hasFilteringStream(): boolean {
    return this.filteringStream != null;
  }

  public get filtersChanged(): boolean {
    if (this.filteringStream != null && this.filteringStream.filters) {
      return !this.store.controls.filters.equals(this.filteringStream.filters);
    }

    if (this.mainStream != null && this.mainStream.filters) {
      return !this.store.controls.filters.equals(this.mainStream.filters);
    }

    return false;
  }
}
