import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { Annotation, RevisionRequestBody, RevisionResult, Sample } from '../api/types'

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
    submitRevision: builder.mutation<
      RevisionResult,
      { sampleId: string; body: RevisionRequestBody; simulateCollaborator?: boolean; injectFailure?: string }
    >({
      query: ({ sampleId, body, simulateCollaborator, injectFailure }) => ({
        url: `api/samples/${sampleId}/revisions`,
        method: 'POST',
        body,
        headers: {
          ...(simulateCollaborator ? { 'x-simulate-collaborator': '1' } : {}),
          ...(injectFailure ? { 'x-inject-failure': injectFailure } : {}),
        },
      }),
    }),
    retryRevision: builder.mutation<RevisionResult, { sampleId: string; journalId: string; injectFailure?: string }>({
      query: ({ sampleId, journalId, injectFailure }) => ({
        url: `api/samples/${sampleId}/revisions/${journalId}/retry`,
        method: 'POST',
        headers: injectFailure ? { 'x-inject-failure': injectFailure } : {},
        body: {},
      }),
    }),
  }),
})

export const {
  useGetSamplesQuery,
  useGetSampleQuery,
  useAddAnnotationMutation,
  useAddCommentMutation,
  useSubmitRevisionMutation,
  useRetryRevisionMutation,
} = samplingApi
