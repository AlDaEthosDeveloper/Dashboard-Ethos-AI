import { ReactNode } from 'react';
import NotFound from '@/pages/NotFound';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { type AppPageKey } from '@/lib/pageRegistry';

interface PageVisibilityGuardProps {
  pageKey: AppPageKey;
  children: ReactNode;
}

export const PageVisibilityGuard = ({ pageKey, children }: PageVisibilityGuardProps) => {
  const { config } = useAppConfig();
  const isVisible = config.pageVisibility[pageKey] !== false;
  if (!isVisible) {
    return <NotFound />;
  }
  return <>{children}</>;
};
