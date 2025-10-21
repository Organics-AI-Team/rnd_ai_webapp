"use client";

import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Beaker, BoxIcon, TrendingUp, Users } from "lucide-react";

function MetricsCards() {
  const { data: formulas, isLoading: formulasLoading } = trpc.formulas.list.useQuery();
  const { data: productsData, isLoading: productsLoading } = trpc.products.list.useQuery({
    limit: 1
  });

  const totalFormulas = formulas?.length || 0;
  const totalIngredients = productsData?.totalCount || 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Formulas</CardTitle>
          <Beaker className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formulasLoading ? "..." : totalFormulas.toLocaleString()}
          </div>
          <p className="text-xs text-purple-100">
            Production formulas
          </p>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Ingredients</CardTitle>
          <BoxIcon className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {productsLoading ? "..." : totalIngredients.toLocaleString()}
          </div>
          <p className="text-xs text-blue-100">
            Raw materials available
          </p>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Efficiency</CardTitle>
          <TrendingUp className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formulasLoading || productsLoading ? "..." :
             totalIngredients > 0 ? Math.round((totalFormulas / totalIngredients) * 100) : 0}
          </div>
          <p className="text-xs text-green-100">
            Formula ratio %
          </p>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Resources</CardTitle>
          <Users className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formulasLoading || productsLoading ? "..." :
             (totalFormulas + totalIngredients).toLocaleString()}
          </div>
          <p className="text-xs text-orange-100">
            Total resources
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Home() {
  const { user, isLoading } = useAuth();

  // Show loading state while auth is loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              R&D AI Management Dashboard
            </h1>
            <p className="text-gray-600">
              Track your formulas and ingredients in one place
            </p>
          </div>

          {/* Metrics Cards */}
          {user && <MetricsCards />}
        </div>
      </div>
    </div>
  );
}
