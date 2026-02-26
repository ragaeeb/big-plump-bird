import {
    type Icon,
    IconChartBar,
    IconFileWord,
    IconListDetails,
    IconPlus,
    IconRefresh,
    IconVideo,
} from '@tabler/icons-react';
import type { ComponentProps } from 'react';
import { Badge } from '@/components/ui/badge';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import type { AppView } from '@/lib/views';

type SidebarItem = {
    id: AppView;
    title: string;
    icon: Icon;
    badge?: string;
};

type AppSidebarProps = ComponentProps<typeof Sidebar> & {
    view: AppView;
    onViewChange: (view: AppView) => void;
    onRefresh: () => void;
    queuedCount: number;
    transcriptCount: number;
};

export function AppSidebar({ onRefresh, onViewChange, queuedCount, transcriptCount, view, ...props }: AppSidebarProps) {
    const primaryItems: SidebarItem[] = [
        {
            icon: IconPlus,
            id: 'new-job',
            title: 'New Job',
        },
        {
            badge: queuedCount > 0 ? String(queuedCount) : undefined,
            icon: IconListDetails,
            id: 'job-queue',
            title: 'Job Queue',
        },
        {
            icon: IconVideo,
            id: 'recent-videos',
            title: 'Recent Videos',
        },
        {
            badge: transcriptCount > 0 ? String(transcriptCount) : undefined,
            icon: IconFileWord,
            id: 'transcriptions',
            title: 'Transcriptions',
        },
        {
            icon: IconChartBar,
            id: 'analytics',
            title: 'Analytics',
        },
    ];

    return (
        <Sidebar collapsible="offcanvas" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton className="data-[slot=sidebar-menu-button]:!p-1.5">
                            <img alt="Big Plump Bird" className="size-5 rounded-sm" src="/vite.svg" />
                            <span className="brand-primary-text text-base font-semibold">Big Plump Bird</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Workflow</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {primaryItems.map((item) => (
                                <SidebarMenuItem key={item.id}>
                                    <SidebarMenuButton
                                        isActive={view === item.id}
                                        onClick={() => onViewChange(item.id)}
                                        tooltip={item.title}
                                    >
                                        <item.icon />
                                        <span>{item.title}</span>
                                        {item.badge ? (
                                            <Badge className="ml-auto h-5 px-1.5 text-xs" variant="secondary">
                                                {item.badge}
                                            </Badge>
                                        ) : null}
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                <SidebarGroup className="mt-auto">
                    <SidebarGroupLabel>Actions</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <SidebarMenuButton onClick={onRefresh} tooltip="Refresh all data">
                                    <IconRefresh />
                                    <span>Refresh</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <div className="text-sidebar-foreground/80 rounded-md border border-sidebar-border px-3 py-2 text-xs">
                    Local-first transcription operations
                </div>
            </SidebarFooter>
        </Sidebar>
    );
}
