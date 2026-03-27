"use client";

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Card, CardContent } from "@/components/ui/card";
import { Beaker, BoxIcon, TrendingUp, Users } from "lucide-react";

/**
 * Dashboard metrics card component
 *
 * Displays key metrics in a compact Cloudflare-style grid
 */
function MetricsCards() {
  const { data: formulas, isLoading: formulasLoading } = trpc.formulas.list.useQuery();
  const { data: productsData, isLoading: productsLoading } = trpc.products.list.useQuery({
    limit: 1
  });

  const totalFormulas = formulas?.length || 0;
  const totalIngredients = productsData?.totalCount || 0;

  const metrics = [
    {
      label: "Formulas",
      value: formulasLoading ? "..." : totalFormulas.toLocaleString(),
      description: "Production formulas",
      icon: Beaker,
      color: "text-violet-600",
      bg: "bg-violet-50",
    },
    {
      label: "Ingredients",
      value: productsLoading ? "..." : totalIngredients.toLocaleString(),
      description: "Raw materials",
      icon: BoxIcon,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Efficiency",
      value: formulasLoading || productsLoading ? "..." :
        totalIngredients > 0 ? `${Math.round((totalFormulas / totalIngredients) * 100)}%` : "0%",
      description: "Formula ratio",
      icon: TrendingUp,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Resources",
      value: formulasLoading || productsLoading ? "..." :
        (totalFormulas + totalIngredients).toLocaleString(),
      description: "Total assets",
      icon: Users,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
                <div className={`w-7 h-7 rounded-md ${metric.bg} flex items-center justify-center`}>
                  <Icon className={`h-3.5 w-3.5 ${metric.color}`} />
                </div>
              </div>
              <div className="text-xl font-semibold text-foreground">{metric.value}</div>
              <p className="text-2xs text-muted-foreground mt-0.5">{metric.description}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * Home dashboard page
 *
 * Displays overview metrics and quick navigation
 */
export default function Home() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent mx-auto"></div>
          <p className="mt-3 text-xs text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Overview of your formulas and ingredients
        </p>
      </div>

      {/* Metrics */}
      {user && <MetricsCards />}
    </div>
  );
}
