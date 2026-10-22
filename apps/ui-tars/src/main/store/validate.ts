/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

import { SearchEngineForSettings, VLMProviderV2, Operator } from './types';

const PresetSourceSchema = z.object({
  type: z.enum(['local', 'remote']),
  url: z.string().url().optional(),
  autoUpdate: z.boolean().optional(),
  lastUpdated: z.number().optional(),
});

export const PresetSchema = z.object({
  // Local VLM Settings
  vlmProvider: z.literal(VLMProviderV2.gemini).optional(),
  vlmBaseUrl: z.string().url(),
  vlmApiKey: z.string().min(1),
  vlmModelName: z
    .string()
    .regex(/^(gemini-[a-zA-Z0-9._-]+|gemma-4-(31b|26b-a4b)-it)$/),
  liveModelName: z
    .string()
    .regex(/^gemini-[a-zA-Z0-9._-]+$/)
    .optional(),
  assistantName: z.string().trim().min(2).max(32).optional(),
  voiceName: z.enum(['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir']).optional(),
  useResponsesApi: z.boolean().optional(),

  providerMode: z.enum(['GOOGLE', 'GROQ', 'BOTH']).optional(),
  groqApiKey: z.string().optional(),
  groqModel: z
    .string()
    .regex(/^[a-zA-Z0-9._/-]{1,120}$/)
    .optional(),
  speechInputModel: z
    .string()
    .regex(/^gemini-[a-zA-Z0-9._-]+$/)
    .optional(),
  speechOutputModel: z
    .string()
    .regex(/^gemini-[a-zA-Z0-9._-]+$/)
    .optional(),

  // Chat Settings
  operator: z.nativeEnum(Operator),
  language: z.enum(['zh', 'en']).optional(),
  screenshotScale: z.number().min(0.1).max(1).optional(),
  maxLoopCount: z.number().min(25).max(200).optional(),
  loopIntervalInMs: z.number().min(0).max(3000).optional(),
  searchEngineForBrowser: z.nativeEnum(SearchEngineForSettings).optional(),

  // Report Settings
  reportStorageBaseUrl: z.string().url().optional(),
  utioBaseUrl: z.string().url().optional(),
  presetSource: PresetSourceSchema.optional(),
});

export type PresetSource = z.infer<typeof PresetSourceSchema>;
export type LocalStore = z.infer<typeof PresetSchema>;

export const validatePreset = (data: unknown): LocalStore => {
  return PresetSchema.parse(data);
};
