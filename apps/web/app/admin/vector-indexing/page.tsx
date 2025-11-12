'use client';

import React, { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Database, Upload, Search, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function VectorIndexingPage() {
  const { user } = useAuth();
  const [batchSize, setBatchSize] = useState(50);
  const [startIndex, setStartIndex] = useState(0);
  const [isIndexing, setIsIndexing] = useState(false);

  const indexMutation = trpc.rag.indexRawMaterials.useMutation();
  const statsQuery = trpc.rag.getIndexStats.useQuery();

  const handleIndexBatch = async () => {
    setIsIndexing(true);
    try {
      await indexMutation.mutateAsync({ batchSize, startIndex });
    } finally {
      setIsIndexing(false);
    }
  };

  if (!user || user.role !== 'admin') {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <Database className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-gray-600">Admin access required for vector indexing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <div className="flex items-center space-x-2 mb-2">
          <Database className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-bold">Vector Database Indexing</h1>
        </div>
        <p className="text-gray-600">
          Index raw materials data into Pinecone vector database for semantic search
        </p>
      </div>

      {/* Indexing Status */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <RefreshCw className="w-5 h-5" />
            <span>Indexing Status</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">
                {statsQuery.data?.success ? statsQuery.data.mongoDBCount : '...'}
              </div>
              <div className="text-sm text-gray-600">MongoDB Documents</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {statsQuery.data?.success ? statsQuery.data.indexedCount : '...'}
              </div>
              <div className="text-sm text-gray-600">Indexed Vectors</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-purple-600">
                {statsQuery.data?.success ?
                  Math.round((statsQuery.data.indexedCount / statsQuery.data.mongoDBCount) * 100) : '...'
                }%
              </div>
              <div className="text-sm text-gray-600">Indexing Progress</div>
            </div>
          </div>

          {statsQuery.data?.success && statsQuery.data.indexedCount < statsQuery.data.mongoDBCount && (
            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center space-x-2 text-yellow-800">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">Indexing Incomplete</span>
              </div>
              <p className="text-sm text-yellow-700 mt-1">
                {statsQuery.data.mongoDBCount - statsQuery.data.indexedCount} documents still need to be indexed.
              </p>
            </div>
          )}

          {statsQuery.data?.success && statsQuery.data.indexedCount >= statsQuery.data.mongoDBCount && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center space-x-2 text-green-800">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">Indexing Complete</span>
              </div>
              <p className="text-sm text-green-700 mt-1">
                All raw materials have been successfully indexed in the vector database.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Indexing Controls */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="w-5 h-5" />
            <span>Batch Indexing</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Batch Size
              </label>
              <Input
                type="number"
                min="1"
                max="100"
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                disabled={isIndexing}
              />
              <p className="text-xs text-gray-500 mt-1">
                Number of documents to index per batch (1-100)
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Index
              </label>
              <Input
                type="number"
                min="0"
                value={startIndex}
                onChange={(e) => setStartIndex(Number(e.target.value))}
                disabled={isIndexing}
              />
              <p className="text-xs text-gray-500 mt-1">
                Starting position for batch processing
              </p>
            </div>
          </div>

          <Button
            onClick={handleIndexBatch}
            disabled={isIndexing}
            className="w-full md:w-auto"
          >
            {isIndexing ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Indexing Batch...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Index Batch ({batchSize} documents)
              </>
            )}
          </Button>

          {indexMutation.data && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center space-x-2 text-blue-800">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">Batch Completed</span>
              </div>
              <p className="text-sm text-blue-700 mt-1">
                {indexMutation.data.message}
              </p>
              {indexMutation.data.documentsIndexed && (
                <div className="mt-2">
                  <p className="text-xs text-blue-600 font-medium mb-1">Recently Indexed:</p>
                  <div className="flex flex-wrap gap-1">
                    {indexMutation.data.documentsIndexed.slice(0, 5).map((doc: any, index: number) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {doc.name}
                      </Badge>
                    ))}
                    {indexMutation.data.documentsIndexed.length > 5 && (
                      <Badge variant="secondary" className="text-xs">
                        +{indexMutation.data.documentsIndexed.length - 5} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {indexMutation.error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center space-x-2 text-red-800">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">Indexing Failed</span>
              </div>
              <p className="text-sm text-red-700 mt-1">
                {indexMutation.error.message}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Database Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Database className="w-5 h-5" />
            <span>Database Information</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="font-medium">Pinecone Index:</span>
              <Badge variant="outline">002-rnd-ai</Badge>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Source Collection:</span>
              <Badge variant="outline">raw_materials_real_stock</Badge>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Embedding Model:</span>
              <Badge variant="outline">text-embedding-3-small</Badge>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Vector Dimensions:</span>
              <Badge variant="outline">1536</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}