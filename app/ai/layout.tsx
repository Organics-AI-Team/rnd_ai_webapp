import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Bot,
  MessageSquare,
  Package,
  BarChart,
  Users,
  ArrowLeft,
  Home,
  Settings
} from 'lucide-react';

const aiNavigation = [
  {
    href: '/ai',
    label: 'AI Hub',
    icon: <Home className="w-4 h-4" />,
    description: 'Overview and quick access'
  },
  {
    href: '/ai/ai-chat',
    label: 'General Chat',
    icon: <MessageSquare className="w-4 h-4" />,
    description: 'General AI assistant'
  },
  {
    href: '/ai/raw-materials-ai',
    label: 'Raw Materials',
    icon: <Package className="w-4 h-4" />,
    description: 'Ingredient research'
  },
  {
    href: '/ai/agents',
    label: 'AI Agents',
    icon: <Users className="w-4 h-4" />,
    description: 'Specialized agents',
    badge: 'New'
  },
  {
    href: '/ai/analytics',
    label: 'Analytics',
    icon: <BarChart className="w-4 h-4" />,
    description: 'Performance metrics'
  }
];

export default function AILayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link href="/" className="flex items-center text-gray-600 hover:text-gray-900">
                <ArrowLeft className="w-5 h-5 mr-2" />
                Back to Main
              </Link>
              <div className="h-6 w-px bg-gray-300" />
              <div className="flex items-center space-x-2">
                <Bot className="w-6 h-6 text-blue-500" />
                <h1 className="text-xl font-bold">AI Hub</h1>
              </div>
            </div>

            <nav className="hidden md:flex items-center space-x-1">
              {aiNavigation.map((item) => {
                const isActive = pathname === item.href ||
                  (item.href !== '/ai' && pathname.startsWith(item.href));

                return (
                  <Link key={item.href} href={item.href}>
                    <Button
                      variant={isActive ? 'default' : 'ghost'}
                      size="sm"
                      className="flex items-center space-x-2"
                    >
                      {item.icon}
                      <span>{item.label}</span>
                      {item.badge && (
                        <Badge variant="secondary" className="text-xs">
                          {item.badge}
                        </Badge>
                      )}
                    </Button>
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm">
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      <div className="md:hidden border-b border-gray-200 bg-white">
        <div className="container mx-auto px-6 py-3">
          <div className="flex space-x-2 overflow-x-auto">
            {aiNavigation.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== '/ai' && pathname.startsWith(item.href));

              return (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant={isActive ? 'default' : 'ghost'}
                    size="sm"
                    className="flex items-center space-x-1 whitespace-nowrap"
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {item.badge && (
                      <Badge variant="secondary" className="text-xs">
                        {item.badge}
                      </Badge>
                    )}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Side Navigation (Desktop) */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:block lg:w-64 lg:overflow-y-auto lg:bg-white lg:border-r lg:border-gray-200">
        <div className="flex h-full flex-col">
          <div className="flex-1 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">AI Services</h2>
            <nav className="space-y-2">
              {aiNavigation.slice(1).map((item) => {
                const isActive = pathname === item.href ||
                  (item.href !== '/ai' && pathname.startsWith(item.href));

                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div className={isActive ? 'text-blue-600' : ''}>
                          {item.icon}
                        </div>
                        <div>
                          <div className="font-medium">{item.label}</div>
                          <div className="text-xs text-gray-500">{item.description}</div>
                        </div>
                      </div>
                      {item.badge && (
                        <Badge variant={isActive ? 'default' : 'secondary'} className="text-xs">
                          {item.badge}
                        </Badge>
                      )}
                    </div>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* System Status */}
          <div className="p-6 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-900 mb-3">System Status</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">AI Services</span>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-green-600">Active</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Knowledge Base</span>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-green-600">8 Indices</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Response Time</span>
                <span className="text-gray-900">1.3s avg</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="lg:pl-64">
        <div className="py-6">
          {children}
        </div>
      </main>
    </div>
  );
}