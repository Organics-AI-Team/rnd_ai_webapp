'use client';

import { useState } from 'react';
import { useSimpleChemicalAIChat, CHEMICAL_AGENTS_V3, type AgentType } from '@/hooks/useSimpleChemicalAIChat';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Bot, User, AlertCircle, Send, Trash2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AIChatPage() {
  const [showSuggestions, setShowSuggestions] = useState(true);

  const {
    messages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    sendMessage,
    clearChat,
    hasMessages
  } = useSimpleChemicalAIChat({
    agent_type: 'chemical_compound',
    on_error: (err) => {
      console.error('Chat error:', err);
    },
  });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setShowSuggestions(false);
    sendMessage(input, 'chemical_compound');
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    setShowSuggestions(false);
  };

  const suggestions = [
    "สารให้ความชุ่มชื้นที่ดีที่สุดคืออะไร?",
    "อยากทำครีมกันแดดต้องใช้สารอะไรบ้าง?",
    "pH ที่เหมาะสมสำหรับผิวหน้าคือเท่าไหร่?",
    "วิธีการแก้ไขปัญหาสิวด้วยสารเคมี",
    "สารที่ช่วยให้ผิวกระจ่างใส",
    "ข้อควรระวังในการใช้กรดบนผิวหน้า",
  ];

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          AI Chemical Expert
        </h1>
        <p className="text-gray-600">
          ปรึกษาเรื่องสารเคมีและเคมีความงามกับผู้เชี่ยวชาญ AI
        </p>
      </div>

      {/* Main Chat Area */}
      <Card className="h-[600px] flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-green-600" />
              AI Chemical Expert
            </CardTitle>
            <div className="flex items-center gap-2">
              {hasMessages && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearChat}
                  className="text-xs"
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  เคลียร์
                </Button>
              )}
              <Badge variant="outline" className="text-green-700 border-green-200">
                พร้อมให้คำปรึกษา
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col p-0">
          {/* Messages Area */}
          <ScrollArea className="flex-1 p-4">
            {!hasMessages && showSuggestions && (
              <div className="text-center py-8">
                <Bot className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  สวัสดี! ฉันคือ AI Chemical Expert
                </h3>
                <p className="text-gray-600 mb-6">
                  พิมพ์คำถามเพื่อเริ่มการสนทนา
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
                  {suggestions.map((suggestion, idx) => (
                    <Button
                      key={idx}
                      variant="outline"
                      className="h-auto p-3 text-left text-sm justify-start"
                      onClick={() => handleSuggestionClick(suggestion)}
                    >
                      {suggestion}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-3",
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {message.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-green-600" />
                    </div>
                  )}

                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg p-4",
                      message.role === 'user'
                        ? 'bg-blue-500 text-white ml-auto'
                        : 'bg-gray-100 text-gray-900'
                    )}
                  >
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">
                      {message.content}
                    </div>
                  </div>

                  {message.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-green-600" />
                  </div>
                  <div className="bg-gray-100 rounded-lg p-4">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm text-gray-600">กำลังคิด...</span>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-[80%]">
                    <p className="text-sm text-red-800">
                      <strong>ข้อผิดพลาด:</strong> {error.message}
                    </p>
                    <p className="text-xs text-red-600 mt-1">
                      กรุณาลองใหม่อีกครั้ง
                    </p>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input Area */}
          <div className="border-t p-4">
            <form onSubmit={handleSend} className="flex gap-2">
              <Input
                value={input}
                onChange={handleInputChange}
                placeholder="ถาม AI Chemical Expert..."
                disabled={isLoading}
                className="flex-1"
              />
              <Button
                type="submit"
                disabled={isLoading || !input.trim()}
                size="icon"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}