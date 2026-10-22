/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarTrigger,
} from '@renderer/components/ui/sidebar';

import { Sparkles } from 'lucide-react';

interface HeaderProps {
  showTrigger: boolean;
}

export function UITarsHeader({ showTrigger }: HeaderProps) {
  return (
    <SidebarMenu className="items-center">
      <SidebarMenuButton
        // size="lg"
        className="group-data-[collapsible=icon]:p-0! mb-2 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground hover:bg-transparent"
      >
        <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
          <Sparkles className="size-7 text-blue-600" />
        </div>
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-semibold">Gemini</span>
          <span className="truncate text-xs pb-[1px]">Voice & actions</span>
        </div>
      </SidebarMenuButton>
      {showTrigger && (
        <SidebarTrigger className="absolute top-12 right-2 group-data-[collapsible=icon]:right-[-36px]" />
      )}
    </SidebarMenu>
  );
}
