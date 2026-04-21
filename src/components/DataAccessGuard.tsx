import { FormEvent, ReactNode, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

interface DataAccessGuardProps {
  children: ReactNode;
}

const SESSION_KEY = 'ethos-data-access-session';

export const DataAccessGuard = ({ children }: DataAccessGuardProps) => {
  const { config } = useAppConfig();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const requiredUsername = config.dataAccessUsername.trim();
  const requiredPassword = config.dataAccessPassword.trim();

  const isProtectionEnabled = requiredUsername.length > 0 && requiredPassword.length > 0;

  const expectedSessionValue = useMemo(
    () => `${requiredUsername}:${requiredPassword}`,
    [requiredUsername, requiredPassword],
  );

  if (!isProtectionEnabled) {
    return <>{children}</>;
  }

  const currentSessionValue = sessionStorage.getItem(SESSION_KEY);
  if (currentSessionValue === expectedSessionValue) {
    return <>{children}</>;
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (username.trim() === requiredUsername && password === requiredPassword) {
      sessionStorage.setItem(SESSION_KEY, expectedSessionValue);
      setError('');
      return;
    }

    setError('Invalid username or password.');
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Data section is protected
          </CardTitle>
          <CardDescription>Enter credentials from Configuration to access this Data page.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="data-login-username">Username</Label>
              <Input
                id="data-login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="data-login-password">Password</Label>
              <Input
                id="data-login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">Unlock Data pages</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
