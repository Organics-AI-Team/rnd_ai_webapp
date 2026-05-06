'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Database, Search, CheckCircle, AlertCircle, Activity, Info } from 'lucide-react';
import { cn } from '@rnd-ai/shared-utils';

interface IndexStats {
  dimension?: number;
  indexFullness?: number;
  totalRecordCount?: number;
  namespaces?: Record<string, any>;
}

interface IndexInfo {
  name: string;
  dimension?: number;
  metric?: string;
  status?: string;
  state?: string;
}

interface IndexManagementResult {
  success: boolean;
  message: string;
  action?: string;
  indexStats?: IndexInfo & { totalRecordCount?: number; indexFullness?: number };
  validations?: {
    embeddingGeneration: string;
    vectorOperations: string;
    correctDimensions: string;
  };
  error?: string;
  warning?: string;
  requiresConfirmation?: boolean;
  expectedIndexName?: string;
}

export default function AIIndexingPage() {
  const [isManagingIndex, setIsManagingIndex] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [lastManagementResult, setLastManagementResult] = useState<IndexManagementResult | null>(null);
  const [indexStats, setIndexStats] = useState<IndexStats | null>(null);
  const [indexInfo, setIndexInfo] = useState<IndexInfo | null>(null);

  const validateAndRecreateIndex = async (forceRecreate = false) => {
    setIsManagingIndex(true);
    setLastManagementResult(null);

    try {
      const response = await fetch('/api/index-data/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'validate-and-recreate',
          confirmIndexName: '002-rnd-ai',
          forceRecreate
        }),
      });

      const result: IndexManagementResult = await response.json();
      setLastManagementResult(result);

      if (result.success) {
        // Refresh index stats after successful management
        await Promise.all([
          loadIndexStats(),
          loadIndexInfo()
        ]);

        // If index was recreated, trigger data indexing
        if (result.action === 'recreated') {
          setTimeout(() => {
            window.location.href = '/api/index-data'; // Trigger data indexing via direct API call
          }, 3000);
        }
      }

      if (result.requiresConfirmation) {
        setShowConfirmDialog(true);
      }

    } catch (error) {
      setLastManagementResult({
        success: false,
        message: 'Failed to manage index',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsManagingIndex(false);
    }
  };

  const loadIndexInfo = async () => {
    try {
      const response = await fetch('/api/index-data/manage');
      const result = await response.json();

      if (result.success) {
        setIndexInfo(result.indexInfo);
      }
    } catch (error) {
      console.error('Failed to load index info:', error);
    }
  };

  const loadIndexStats = async () => {
    setIsLoadingStats(true);
    try {
      const response = await fetch('/api/index-data');
      const result = await response.json();

      if (result.success) {
        setIndexStats(result.stats);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const refreshAllData = async () => {
    setIsLoadingStats(true);
    try {
      await Promise.all([
        loadIndexStats(),
        loadIndexInfo()
      ]);
    } finally {
      setIsLoadingStats(false);
    }
  };

  // Load stats and index info on mount
  useEffect(() => {
    refreshAllData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          การจัดการดัชนีข้อมูล AI
        </h1>
        <p className="text-gray-600">
          สร้างและจัดการดัชนี Pinecone Index เพื่อให้แน่ใจว่ามีมิติที่ถูกต้อง (3072)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Index Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              สถานะปัจจุบัน
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current Index Status */}
            <div className="space-y-3">
              <h4 className="font-medium">สถานะปัจจุบัน</h4>
              {indexInfo ? (
                <div className="space-y-2 p-3 bg-gray-50 rounded-lg">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">ชื่อ Index:</span>
                    <Badge variant="outline">{indexInfo.name}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">มิติ:</span>
                    <Badge
                      variant={indexInfo.dimension === 3072 ? "default" : "destructive"}
                    >
                      {indexInfo.dimension || 'N/A'} {indexInfo.dimension === 3072 ? '✅' : '❌'}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">จำนวนข้อมูล:</span>
                    <Badge variant="secondary">
                      {indexStats?.totalRecordCount?.toLocaleString() || '0'}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">สถานะ:</span>
                    <Badge
                      variant={indexInfo.status === 'Ready' ? "default" : "secondary"}
                    >
                      {indexInfo.status || 'N/A'}
                    </Badge>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-gray-500">
                  <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">กำลัดดูข้อมูล...</p>
                </div>
              )}
            </div>

            {/* Single Button for Index Creation */}
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800 font-medium mb-2">
                  คลิกปุ่ม &quot;สร้าง/อัปเดตดัชนี&quot; เพื่อเริ่มต้นการจัดการดัชนีข้อมูล
                </p>
                <p className="text-xs text-blue-700">
                  ระบบจะตรวจสอบและสร้าง Index ใหม่ด้วยมิติ 3072 หากจำเป็นที่จำเป็น
                </p>
              </div>

              <Button
                onClick={() => setShowConfirmDialog(true)}
                disabled={isManagingIndex}
                className="w-full justify-start"
                size="lg"
              >
                {isManagingIndex ? (
                  <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                ) : (
                  <Database className="w-5 h-5 mr-3" />
                )}
                {isManagingIndex ? 'กำลัดการจัดการ...' : 'สร้าง/อัปเดตดัชนีข้อมูล'}
              </Button>
            </div>

            {/* Management Result */}
            {lastManagementResult && (
              <div className={cn(
                "p-4 rounded-lg border",
                lastManagementResult.success
                  ? lastManagementResult.action === 'none'
                    ? "bg-blue-50 border-blue-200"
                    : "bg-green-50 border-green-200"
                  : "bg-red-50 border-red-200"
              )}>
                <div className="flex items-center gap-2 mb-2">
                  {lastManagementResult.success ? (
                    lastManagementResult.action === 'none' ? (
                      <CheckCircle className="w-4 h-4 text-blue-600" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    )
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-600" />
                  )}
                  <span className="text-sm font-medium">
                    {lastManagementResult.success
                      ? (lastManagementResult.action === 'none' ? 'ตรวจสอบสำเร็จ' : 'สำเร็จ')
                      : 'ผิดพลาด'
                    }
                  </span>
                </div>
                <p className="text-sm text-gray-600 mb-2">
                  {lastManagementResult.message}
                </p>
                {lastManagementResult.validations && (
                  <div className="space-y-1 text-xs">
                    <div className="font-medium">การตรวจสอบ:</div>
                    <div>• {lastManagementResult.validations.embeddingGeneration}</div>
                    <div>• {lastManagementResult.validations.vectorOperations}</div>
                    <div>• {lastManagementResult.validations.correctDimensions}</div>
                  </div>
                )}
                {lastManagementResult.error && (
                  <p className="text-sm text-red-600">
                    รายละเอียด: {lastManagementResult.error}
                  </p>
                )}
                {lastManagementResult.warning && (
                  <p className="text-sm text-yellow-600">
                    คำเตือน: {lastManagementResult.warning}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Index Statistics */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                สถิติดัชนี
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={refreshAllData}
                disabled={isLoadingStats}
              >
                {isLoadingStats ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {indexStats ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium">จำนวน Vectors ทั้งหมด</span>
                  <Badge variant="secondary">
                    {indexStats.totalRecordCount?.toLocaleString() || '0'}
                  </Badge>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium">มิติ (Dimensions)</span>
                  <Badge variant="secondary">
                    {indexStats.dimension || 'N/A'}
                  </Badge>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium">ความจุที่ใช้</span>
                  <Badge variant="secondary">
                    {indexStats.indexFullness
                      ? `${(indexStats.indexFullness * 100).toFixed(1)}%`
                      : 'N/A'
                    }
                  </Badge>
                </div>

                {indexStats.namespaces && Object.keys(indexStats.namespaces).length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium mb-2">Namespaces:</h4>
                    <div className="space-y-1">
                      {Object.entries(indexStats.namespaces).map(([namespace, stats]: [string, any]) => (
                        <div key={namespace} className="flex justify-between items-center p-2 bg-gray-50 rounded text-xs">
                          <span className="font-mono">{namespace}</span>
                          <Badge variant="outline">{stats.recordCount} vectors</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">ยังไม่มีข้อมูลสถิติ</p>
                <p className="text-xs mt-1">กดปุ่มรีเฟรชเพื่อโหลดข้อมูล</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Information Section */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">ข้อมูลเพิ่มเติม</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div>
              <h4 className="font-medium mb-2">สิ่งที่ถูกสร้าง:</h4>
              <ul className="space-y-1 text-gray-600">
                <li>• สร้าง Index ใหม่ด้วยมิติ 3072</li>
                <li>• ทดสอบการสร้าง embeddings ด้วย Gemini</li>
                <li>• ทดสอบการ insert/query vectors</li>
                <li>• ทำงานกับ MongoDB เพื่อ index ข้อมูลสารเคมี</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">วิธีการทำงาน:</h4>
              <ul className="space-y-1 text-gray-600">
                <li>• ลบ Index เก่า (ถ้ามี) และสร้างใหม่</li>
                <li>• ตรวจสอบมิติด้วยถูกต้อง</li>
                <li>• ทดสอบการทำงานของ APIs</li>
                <li>• แสดงผลการทำงานแบบ Real-time</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                ยืนยันการสร้าง Index ใหม่
              </h3>
              <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
                <p className="text-sm text-red-800 font-medium mb-2">
                  ⚠️ การดำเนินการนี้จะ:
                </p>
                <ul className="text-sm text-red-700 space-y-1">
                  <li>• ลบ Index ปัจจุบันทั้งหมด</li>
                  <li>• สร้าง Index ใหม่ด้วยมิติ 3072</li>
                  <li>• ข้อมูลเก่าทั้งหมดจะถูกลบไป</li>
                  <li>• ต้องทำการสร้างดัชนีข้อมูลใหม่ทั้งหมด</li>
                </ul>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded p-3">
                <p className="text-sm text-blue-800">
                  กรุณาพิมพ์ <span className="font-mono bg-blue-100 px-2 py-1 rounded">002-rnd-ai</span> เพื่อยืนยัน
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowConfirmDialog(false)}
                disabled={isManagingIndex}
              >
                ยกเลิก
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  setShowConfirmDialog(false);
                  await validateAndRecreateIndex(true); // Force recreate
                  // After successful recreation, trigger data indexing
                  setTimeout(() => {
                    window.location.href = '/api/index-data';
                  }, 5000);
                }}
                disabled={isManagingIndex}
              >
                {isManagingIndex ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                ยืนยันและสร้างใหม่
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}