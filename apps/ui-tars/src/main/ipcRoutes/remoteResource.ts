/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@ui-tars/electron-ipc/main';

const t = initIpc.create();

type ResourceType = 'computer' | 'hdfBrowser';

export const remoteResourceRouter = t.router({
  allocRemoteResource: t.procedure
    .input<{
      resourceType: ResourceType;
    }>()
    .handle(async ({ input }) => {
      const { ProxyClient } = await import('../remote/proxyClient');
      return ProxyClient.allocResource(input.resourceType);
    }),
  getRemoteResourceRDPUrl: t.procedure
    .input<{
      resourceType: ResourceType;
    }>()
    .handle(async ({ input }) => {
      const { ProxyClient } = await import('../remote/proxyClient');
      switch (input.resourceType) {
        case 'computer':
          return ProxyClient.getSandboxRDPUrl();
        case 'hdfBrowser':
          return ProxyClient.getBrowserCDPUrl();
        default:
          return null;
      }
    }),
  releaseRemoteResource: t.procedure
    .input<{
      resourceType: ResourceType;
    }>()
    .handle(async ({ input }) => {
      const { ProxyClient } = await import('../remote/proxyClient');
      return ProxyClient.releaseResource(input.resourceType);
    }),
  getTimeBalance: t.procedure
    .input<{
      resourceType: ResourceType;
    }>()
    .handle(async ({ input }) => {
      const { ProxyClient } = await import('../remote/proxyClient');
      const balance = await ProxyClient.getTimeBalance();

      switch (input.resourceType) {
        case 'computer':
          return balance.computerBalance;
        case 'hdfBrowser':
          return balance.browserBalance;
        default:
          return -1;
      }
    }),
});
