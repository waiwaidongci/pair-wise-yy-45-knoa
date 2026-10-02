import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { Annotation, Checkpoint, Reconfirmation, RevisionChange, Sample } from '../api/types'

type SubmitRevisionRequest = {
  sampleId: string
  batchId: string
  author: string
  baseVersion: number
  changes: RevisionChange[]
  simulateConcurrent?: boolean
  injectFailure?: boolean
}

type ResumeRevisionRequest = {
  sampleId: string
  batchId: string
  author: string
  baseVersion: number
  changes: RevisionChange[]
  resumeCompleted: Array<'spec' | 'annotation'>
}

export const samplingApi = createApi({
  reducerPath: 'samplingApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  tagTypes: ['Sample', 'Samples'],
  endpoints: (builder) => ({
    getSamples: builder.query<Sample[], void>({
      query: () => 'api/samples',
      providesTags: ['Samples'],
    }),
    getSample: builder.query<Sample, string>({
      query: (id) => `api/samples/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Sample', id }],
    }),
    submitRevision: builder.mutation<Sample, SubmitRevisionRequest>({
      query: ({ sampleId, ...body }) => ({
        url: `api/samples/${sampleId}/revisions`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { sampleId }) => [{ type: 'Sample', id: sampleId }, 'Samples'],
    }),
    resumeRevision: builder.mutation<Sample, ResumeRevisionRequest>({
      query: ({ sampleId, ...body }) => ({
        url: `api/samples/${sampleId}/revisions`,
        method: 'POST',
        body: { ...body, resumeCompleted: body.resumeCompleted },
      }),
      invalidatesTags: (_result, _error, { sampleId }) => [{ type: 'Sample', id: sampleId }, 'Samples'],
    }),
    reconfirmCraft: builder.mutation<Sample, { sampleId: string; craftId: string; reconfirmation: Reconfirmation }>({
      query: ({ sampleId, craftId, reconfirmation }) => ({
        url: `api/samples/${sampleId}/crafts/${craftId}/reconfirm`,
        method: 'PUT',
        body: reconfirmation,
      }),
      invalidatesTags: (_result, _error, { sampleId }) => [{ type: 'Sample', id: sampleId }, 'Samples'],
    }),
    addAnnotation: builder.mutation<Sample, { sampleId: string; annotation: Omit<Annotation, 'id' | 'author' | 'status'> }>({
      query: ({ sampleId, annotation }) => ({
        url: `api/samples/${sampleId}/annotations`,
        method: 'POST',
        body: annotation,
      }),
      invalidatesTags: (_result, _error, { sampleId }) => [{ type: 'Sample', id: sampleId }],
    }),
    addComment: builder.mutation<Sample, { sampleId: string; content: string }>({
      query: ({ sampleId, content }) => ({
        url: `api/samples/${sampleId}/comments`,
        method: 'POST',
        body: { content },
      }),
      invalidatesTags: (_result, _error, { sampleId }) => [{ type: 'Sample', id: sampleId }],
    }),
  }),
})

export type { SubmitRevisionRequest, Checkpoint }
export const {
  useGetSamplesQuery,
  useGetSampleQuery,
  useSubmitRevisionMutation,
  useResumeRevisionMutation,
  useReconfirmCraftMutation,
  useAddAnnotationMutation,
  useAddCommentMutation,
} = samplingApi
