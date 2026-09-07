'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/domains/auth/hooks/useAuth';
import { BottomNav } from '@/shared/components/BottomNav';
import { useTranslations } from 'next-intl';
import { Copy, Check, RefreshCw, Radio, Settings, Eye, Gift, Video } from 'lucide-react';
import { DonationHistory } from '@/domains/donation/components/DonationHistory';
import { ModerationPanel } from '@/domains/moderation/components/ModerationPanel';
import { CATEGORIES, MAX_TAGS, MAX_TAG_LENGTH } from '@/domains/stream/categories';
import { useCategoryLabel } from '@/domains/stream/hooks/useCategoryLabel';

interface StreamData {
  id: string;
  stream_key: string;
  title: string;
  description?: string;
  category?: string | null;
  tags?: string[];
  status: 'idle' | 'live' | 'ended';
  viewer_count?: number;
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tStream = useTranslations('stream');
  const categoryLabel = useCategoryLabel();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [stream, setStream] = useState<StreamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<'key' | 'url' | null>(null);
  const [rekeying, setRekeying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // 태그는 자유 입력이라 화면에서는 문자열 하나로 다루고 저장할 때만 쪼갠다
  const [tagInput, setTagInput] = useState('');

  const rtmpUrl = 'rtmp://localhost:1935';

  // MediaMTX 경로 이름은 공개값인 stream id이고, 송출 권한은
  // pass= 로 전달되는 stream_key를 서버가 검증해서 판단한다 (C-04).
  const obsStreamKey =
    stream?.id && stream?.stream_key
      ? `${stream.id}?user=streamer&pass=${stream.stream_key}`
      : '';

  const fetchOrRegister = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stream/register', { method: 'POST' });
      const { data } = await res.json();
      if (data?.stream) {
        setStream(data.stream);
        setTitle(data.stream.title || '');
        setDescription(data.stream.description || '');
        setCategory(data.stream.category ?? null);
        setTagInput((data.stream.tags ?? []).join(', '));
      }
    } catch (err) {
      console.error('Failed to register/fetch stream:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      fetchOrRegister();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [authLoading, user, fetchOrRegister]);

  // Poll status when live
  useEffect(() => {
    if (!stream?.id || stream.status !== 'live') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/stream/${stream.id}`);
        const { data } = await res.json();
        if (data) {
          setStream((prev) => prev ? { ...prev, status: data.status, viewer_count: data.viewer_count } : null);
        }
      } catch {}
    }, 5000);

    return () => clearInterval(interval);
  }, [stream?.id, stream?.status]);

  async function handleCopy(text: string, type: 'key' | 'url') {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleRekey() {
    if (!confirm(t('rekeyConfirm'))) return;
    setRekeying(true);
    try {
      const res = await fetch('/api/stream/rekey', { method: 'POST' });
      const { data } = await res.json();
      if (data?.stream_key) {
        setStream((prev) => prev ? { ...prev, stream_key: data.stream_key } : null);
      }
    } catch (err) {
      console.error('Rekey failed:', err);
    } finally {
      setRekeying(false);
    }
  }

  async function handleSaveSettings() {
    try {
      const res = await fetch('/api/stream/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          category,
          tags: tagInput
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const { data } = await res.json();
      if (data) {
        setStream((prev) => prev ? { ...prev, ...data } : null);
        setEditing(false);
      }
    } catch (err) {
      console.error('Save settings failed:', err);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-950">
        <p className="text-gray-400">{t('loginRequired')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gray-950 text-white">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          {stream?.status === 'live' && (
            <div className="flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1.5">
              <Radio className="h-4 w-4 animate-pulse text-red-500" />
              <span className="text-sm font-medium text-red-400">
                {tStream('live')}
              </span>
              <span className="flex items-center gap-1 text-sm text-gray-300">
                <Eye className="h-3.5 w-3.5" />
                {stream.viewer_count ?? 0}
              </span>
            </div>
          )}
        </div>

        {/* Stream Settings */}
        <section className="mb-6 rounded-xl bg-gray-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Settings className="h-5 w-5" />
              {t('streamSettings')}
            </h2>
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                {t('edit')}
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(false)}
                  className="text-sm text-gray-400 hover:text-gray-300"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleSaveSettings}
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  {t('save')}
                </button>
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm text-gray-400">
                  {t('streamTitle')}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg bg-gray-800 px-4 py-2.5 text-white outline-none ring-1 ring-gray-700 focus:ring-blue-500"
                  placeholder={t('streamTitlePlaceholder')}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-gray-400">
                  {t('streamDescription')}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-lg bg-gray-800 px-4 py-2.5 text-white outline-none ring-1 ring-gray-700 focus:ring-blue-500"
                  rows={3}
                  placeholder={t('streamDescriptionPlaceholder')}
                />
              </div>

              {/* 카테고리는 고른다. 자유 입력이면 오타로 분류가 갈라진다 */}
              <div>
                <label className="mb-1.5 block text-sm text-gray-400">
                  {t('category')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setCategory((prev) => (prev === c.id ? null : c.id))
                      }
                      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                        category === c.id
                          ? 'bg-white font-semibold text-black'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {c.emoji} {categoryLabel(c.id)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm text-gray-400">
                  {t('tags')}{' '}
                  <span className="text-gray-600">
                    {t('tagsHint', { max: MAX_TAGS })}
                  </span>
                </label>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  className="w-full rounded-lg bg-gray-800 px-4 py-2.5 text-white outline-none ring-1 ring-gray-700 focus:ring-blue-500"
                  placeholder={t('tagsPlaceholder', { max: MAX_TAG_LENGTH })}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-white">{stream?.title || t('noTitle')}</p>
              <p className="text-sm text-gray-400">
                {stream?.description || t('noDescription')}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {stream?.category ? (
                  <span className="rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-200">
                    {categoryLabel(stream.category)}
                  </span>
                ) : (
                  <span className="text-xs text-gray-600">
                    {t('noCategoryWarning')}
                  </span>
                )}
                {(stream?.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-gray-800/60 px-2.5 py-1 text-xs text-gray-400"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <ModerationPanel />

        {/* 모바일 웹 방송 */}
        <section className="mb-6 rounded-xl bg-gray-900 p-6">
          <h2 className="mb-1 text-lg font-semibold">{t('phoneTitle')}</h2>
          <p className="mb-4 text-sm text-gray-400">{t('phoneBody')}</p>
          <button
            onClick={() => router.push('/broadcast')}
            disabled={stream?.status === 'live'}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 font-bold text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Video className="h-5 w-5" />
            {stream?.status === 'live' ? t('alreadyLive') : t('goLive')}
          </button>
        </section>

        {/* Stream Key & OBS Setup */}
        <section className="mb-6 rounded-xl bg-gray-900 p-6">
          <h2 className="mb-4 text-lg font-semibold">{t('obsSetup')}</h2>

          {/* RTMP URL */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm text-gray-400">
              {t('rtmpUrl')}
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-green-400">
                {rtmpUrl}
              </code>
              <button
                onClick={() => handleCopy(rtmpUrl, 'url')}
                className="rounded-lg bg-gray-800 p-2.5 text-gray-400 transition-colors hover:text-white"
              >
                {copied === 'url' ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Stream Key */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm text-gray-400">
              {t('streamKey')}
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-gray-800 px-4 py-2.5 text-sm text-yellow-400">
                {obsStreamKey || '...'}
              </code>
              <button
                onClick={() => obsStreamKey && handleCopy(obsStreamKey, 'key')}
                className="rounded-lg bg-gray-800 p-2.5 text-gray-400 transition-colors hover:text-white"
              >
                {copied === 'key' ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {t.rich('streamKeyHint', {
                code: (chunks) => (
                  <code className="text-gray-400">{chunks}</code>
                ),
              })}
            </p>
          </div>

          {/* Rekey Button */}
          <button
            onClick={handleRekey}
            disabled={rekeying || stream?.status === 'live'}
            className="flex items-center gap-2 text-sm text-orange-400 transition-colors hover:text-orange-300 disabled:cursor-not-allowed disabled:text-gray-600"
          >
            <RefreshCw className={`h-4 w-4 ${rekeying ? 'animate-spin' : ''}`} />
            {t('rekey')}
          </button>
        </section>

        {/* OBS Guide */}
        <section className="rounded-xl bg-gray-900 p-6">
          <h2 className="mb-4 text-lg font-semibold">{t('obsGuide')}</h2>
          {/*
            단계 문구는 언어마다 강조 위치가 다르다 ("Settings → Stream"이
            문장 앞에 오기도 뒤에 오기도 한다). 그래서 <strong>을 JSX로
            박지 않고 사전 안에 <b>…</b>로 두고 t.rich로 렌더한다.
          */}
          <ol className="space-y-3 text-sm text-gray-300">
            {[1, 2, 3, 4, 5].map((step) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-400">
                  {step}
                </span>
                <span>
                  {t.rich(`obsStep${step}`, {
                    b: (chunks) => (
                      <strong className="text-white">{chunks}</strong>
                    ),
                  })}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-4 rounded-lg bg-yellow-500/10 p-3 text-sm text-yellow-300">
            {t.rich('portraitTip', {
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </div>
        </section>

        {/* Donation History */}
        <section className="mt-6 rounded-xl bg-gray-900 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Gift className="h-5 w-5 text-yellow-400" />
            {t('tipsReceived')}
          </h2>
          <DonationHistory type="received" />

          <button
            onClick={() => router.push('/payout')}
            className="mt-4 w-full rounded-lg bg-white/10 py-3 text-sm font-medium text-white transition hover:bg-white/15"
          >
            {t('cashOut')}
          </button>
        </section>

        {/* Bottom nav spacer */}
        <div className="h-20" />
      </div>
      <BottomNav />
    </div>
  );
}
