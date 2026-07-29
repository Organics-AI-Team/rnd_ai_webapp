import type { Collection, Db, Document, WithId } from "mongodb";
import type { TenantExecutionContext } from "@rnd-ai/shared-types";

import { resolve_raw_materials_db } from "./conversation-repository";
import {
  delete_scoped_document,
  get_scoped_document,
  insert_scoped_document,
  list_scoped_documents,
  tenant_scope,
  update_scoped_document,
} from "./tenant-repository-base";

const NOT_FOUND = "FEEDBACK_NOT_FOUND";

/**
 * Collection names owned by this repository. They are private constants on
 * purpose: routers can never supply a collection name.
 */
const AI_RESPONSES_COLLECTION = "ai_responses";
const FEEDBACK_ANALYTICS_COLLECTION = "feedback_analytics";
const RAW_MATERIALS_FEEDBACK_COLLECTION = "raw_materials_feedback";

/** Options for listing the acting profile's own feedback history. */
export interface ListOwnFeedbackOptions {
  /** Optional AI service discriminator for isolated per-service learning. */
  readonly service_name?: string;
  /** Maximum documents to return. */
  readonly limit: number;
  /** Documents to skip from the newest end. */
  readonly offset: number;
}

/** Options narrowing the tenant analytics window. */
export interface FeedbackAnalyticsOptions {
  /** Inclusive lower bound on feedback timestamps. */
  readonly start_date: Date;
  /** Optional AI model discriminator. */
  readonly model?: string;
}

/** Tenant-scoped aggregate datasets consumed by feedback.getAnalytics. */
export interface FeedbackAnalyticsSnapshot {
  readonly total_feedback: number;
  readonly average_score: number;
  readonly feedback_by_type: Document[];
  readonly score_trend: Document[];
  readonly user_engagement: Document[];
  readonly model_performance: Document[];
  readonly response_length_analysis: Document[];
}

/** Per-actor aggregate snapshot of the raw-materials feedback log. */
export interface RawMaterialFeedbackStats {
  readonly total_feedback: number;
  readonly average_score: number;
  readonly feedback_by_type: Document[];
}

/**
 * Tenant-scoped repository over the feedback collection (plus its
 * ai_responses / feedback_analytics rollup collections and the
 * raw-materials feedback log). Every method takes a TenantExecutionContext —
 * never a tenant ID.
 */
export interface FeedbackRepository {
  create_feedback(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  get_feedback(context: TenantExecutionContext, feedback_id: string): Promise<WithId<Document>>;
  list_feedback(context: TenantExecutionContext): Promise<WithId<Document>[]>;
  update_feedback(
    context: TenantExecutionContext,
    feedback_id: string,
    patch: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  delete_feedback(context: TenantExecutionContext, feedback_id: string): Promise<void>;

  /** Feedback rows of one AI response, scoped by tenant AND responseId. */
  list_feedback_for_response(
    context: TenantExecutionContext,
    response_id: string,
  ): Promise<WithId<Document>[]>;
  /** The acting profile's own feedback history (newest first). */
  list_own_feedback(
    context: TenantExecutionContext,
    options: ListOwnFeedbackOptions,
  ): Promise<WithId<Document>[]>;
  /** Tenant-wide aggregate analytics datasets. */
  get_feedback_analytics(
    context: TenantExecutionContext,
    options: FeedbackAnalyticsOptions,
  ): Promise<FeedbackAnalyticsSnapshot>;
  /** Fold one submitted feedback into the tenant's ai_responses rollup. */
  record_response_feedback(
    context: TenantExecutionContext,
    response_id: string,
    feedback_document: WithId<Document>,
  ): Promise<void>;
  /** Append one tenant+actor stamped analytics event. */
  record_feedback_event(
    context: TenantExecutionContext,
    event: Record<string, unknown>,
  ): Promise<void>;

  /** Raw-materials feedback log (separate raw-materials database). */
  create_raw_material_feedback(
    context: TenantExecutionContext,
    input: Record<string, unknown>,
  ): Promise<WithId<Document>>;
  get_own_raw_material_feedback_stats(
    context: TenantExecutionContext,
  ): Promise<RawMaterialFeedbackStats>;
  list_own_recent_raw_material_feedback(
    context: TenantExecutionContext,
    limit: number,
  ): Promise<WithId<Document>[]>;
}

/**
 * Build the tenant+actor filter used by every "own feedback" read.
 *
 * @param context - Verified tenant execution context.
 * @returns Filter fragment `{ tenantId, actorProfileId }`.
 */
function own_feedback_filter(context: TenantExecutionContext): Document {
  return { ...tenant_scope(context), actorProfileId: context.actor_profile_id };
}

/**
 * Resolve the raw-materials feedback collection lazily (separate database;
 * no connection is opened until a raw-material method runs).
 *
 * @returns The raw_materials_feedback collection handle.
 */
async function resolve_raw_material_feedback_collection(): Promise<
  Collection<Document>
> {
  return (await resolve_raw_materials_db()).collection(
    RAW_MATERIALS_FEEDBACK_COLLECTION,
  );
}

/**
 * Create the feedback repository bound to a database handle.
 *
 * @param db - Connected MongoDB database.
 * @returns Repository instance; all failures use code "FEEDBACK_NOT_FOUND".
 */
export function create_feedback_repository(db: Db): FeedbackRepository {
  const feedback = db.collection("feedback");
  const ai_responses = db.collection(AI_RESPONSES_COLLECTION);
  const feedback_analytics = db.collection(FEEDBACK_ANALYTICS_COLLECTION);

  /**
   * Build the tenant-scoped analytics window filter.
   *
   * @param context - Verified tenant execution context.
   * @param options - Analytics window options.
   * @returns MongoDB filter document pinned to the tenant.
   */
  function analytics_filter(
    context: TenantExecutionContext,
    options: FeedbackAnalyticsOptions,
  ): Document {
    const filter: Document = {
      ...tenant_scope(context),
      timestamp: { $gte: options.start_date },
    };
    if (options.model) filter.aiModel = options.model;
    return filter;
  }

  return {
    async create_feedback(context, input) {
      return insert_scoped_document(feedback, context, input, "actor");
    },
    async get_feedback(context, feedback_id) {
      return get_scoped_document(feedback, context, feedback_id, NOT_FOUND);
    },
    async list_feedback(context) {
      return list_scoped_documents(feedback, context);
    },
    async update_feedback(context, feedback_id, patch) {
      return update_scoped_document(feedback, context, feedback_id, NOT_FOUND, patch);
    },
    async delete_feedback(context, feedback_id) {
      return delete_scoped_document(feedback, context, feedback_id, NOT_FOUND);
    },

    async list_feedback_for_response(context, response_id) {
      return feedback
        .find({ ...tenant_scope(context), responseId: response_id })
        .sort({ timestamp: -1 })
        .toArray();
    },

    async list_own_feedback(context, options) {
      const filter: Document = own_feedback_filter(context);
      if (options.service_name) filter.service_name = options.service_name;
      return feedback
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(options.offset)
        .limit(options.limit)
        .toArray();
    },

    async get_feedback_analytics(context, options) {
      const filter = analytics_filter(context, options);
      const [
        total_feedback,
        score_rollup,
        feedback_by_type,
        score_trend,
        user_engagement,
        model_performance,
        response_length_analysis,
      ] = await Promise.all([
        feedback.countDocuments(filter),
        feedback
          .aggregate([
            { $match: filter },
            { $group: { _id: null, averageScore: { $avg: "$score" } } },
          ])
          .toArray(),
        feedback
          .aggregate([
            { $match: filter },
            { $group: { _id: "$type", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
          .toArray(),
        feedback
          .aggregate([
            { $match: filter },
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
                averageScore: { $avg: "$score" },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
            {
              $project: {
                date: "$_id",
                score: { $round: ["$averageScore", 2] },
                count: 1,
                _id: 0,
              },
            },
          ])
          .toArray(),
        feedback
          .aggregate([
            { $match: filter },
            {
              // Legacy rows carry userId; converted rows carry the
              // context-stamped actorProfileId. Group on whichever exists.
              $group: {
                _id: { $ifNull: ["$actorProfileId", "$userId"] },
                feedbackCount: { $sum: 1 },
                averageScore: { $avg: "$score" },
              },
            },
            { $sort: { feedbackCount: -1 } },
            {
              $project: {
                userId: "$_id",
                feedbackCount: 1,
                averageScore: { $round: ["$averageScore", 2] },
                _id: 0,
              },
            },
          ])
          .toArray(),
        feedback
          .aggregate([
            { $match: filter },
            {
              $group: {
                _id: "$aiModel",
                averageScore: { $avg: "$score" },
                totalResponses: { $addToSet: "$responseId" },
              },
            },
            {
              $project: {
                model: "$_id",
                averageScore: { $round: ["$averageScore", 2] },
                totalResponses: { $size: "$totalResponses" },
                _id: 0,
              },
            },
          ])
          .toArray(),
        feedback
          .aggregate([
            { $match: filter },
            {
              $bucket: {
                groupBy: "$context.length",
                boundaries: [0, 100, 300, 600, 1000, Infinity],
                default: "Unknown",
                output: {
                  averageLength: { $avg: "$context.length" },
                  averageScore: { $avg: "$score" },
                  count: { $sum: 1 },
                },
              },
            },
            {
              $project: {
                category: {
                  $switch: {
                    branches: [
                      { case: { $eq: ["$_id", 0] }, then: "Very Short" },
                      { case: { $eq: ["$_id", 100] }, then: "Short" },
                      { case: { $eq: ["$_id", 300] }, then: "Medium" },
                      { case: { $eq: ["$_id", 600] }, then: "Long" },
                    ],
                    default: "Very Long",
                  },
                },
                averageLength: { $round: ["$averageLength", 0] },
                averageScore: { $round: ["$averageScore", 2] },
                _id: 0,
              },
            },
          ])
          .toArray(),
      ]);
      return {
        total_feedback,
        average_score: (score_rollup[0]?.averageScore as number | undefined) ?? 0,
        feedback_by_type,
        score_trend,
        user_engagement,
        model_performance,
        response_length_analysis,
      };
    },

    async record_response_feedback(context, response_id, feedback_document) {
      const score_rollup = await feedback
        .aggregate([
          { $match: { ...tenant_scope(context), responseId: response_id } },
          { $group: { _id: null, averageScore: { $avg: "$score" } } },
        ])
        .toArray();
      await ai_responses.updateOne(
        { id: response_id, ...tenant_scope(context) },
        // Mongo driver's PushOperator typing rejects broad Document values;
        // the runtime shape matches the legacy rollup array entries.
        {
          $push: { feedback: feedback_document },
          $inc: { totalFeedback: 1 },
          $set: {
            lastFeedbackAt: new Date(),
            averageScore: (score_rollup[0]?.averageScore as number | undefined) ?? 0,
          },
        } as unknown as Parameters<typeof ai_responses.updateOne>[1],
        { upsert: true },
      );
    },

    async record_feedback_event(context, event) {
      await insert_scoped_document(feedback_analytics, context, event, "actor");
    },

    async create_raw_material_feedback(context, input) {
      const collection = await resolve_raw_material_feedback_collection();
      return insert_scoped_document(collection, context, input, "actor");
    },

    async get_own_raw_material_feedback_stats(context) {
      const collection = await resolve_raw_material_feedback_collection();
      const own = own_feedback_filter(context);
      const [total_feedback, score_rollup, feedback_by_type] = await Promise.all([
        collection.countDocuments(own),
        collection
          .aggregate([
            { $match: own },
            { $group: { _id: null, avgScore: { $avg: "$score" } } },
          ])
          .toArray(),
        collection
          .aggregate([
            { $match: own },
            { $group: { _id: "$type", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
          .toArray(),
      ]);
      return {
        total_feedback,
        average_score: (score_rollup[0]?.avgScore as number | undefined) ?? 0,
        feedback_by_type,
      };
    },

    async list_own_recent_raw_material_feedback(context, limit) {
      const collection = await resolve_raw_material_feedback_collection();
      return collection
        .find(own_feedback_filter(context))
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    },
  };
}
