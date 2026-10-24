import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound, Waypoints } from 'lucide-react';
import AuthLayout from '../layouts/AuthLayout';
import { useAuth } from '../lib/auth';
import { useDocumentTitle } from '../lib/hooks';
import { kbApi } from '../api/kb';
import { ButtonLink } from '../components/ui/Button';
import { Notice } from '../components/ui/Feedback';
import KnowledgeWorkspace from '../components/kb/KnowledgeWorkspace';

export function ForgotPassword() {
  useDocumentTitle('Reset your password');
  return (
    <AuthLayout title="Reset your password" subtitle="Password resets are handled by your Paheli administrator."
      footer={<Link to="/login" className="font-medium text-brand-700 hover:underline">Back to sign in</Link>}>
      <div className="space-y-4 text-[14px] leading-relaxed text-ink-soft">
        <KeyRound className="h-6 w-6 text-ink-faint" strokeWidth={1.5} />
        <p>
          This deployment doesn’t send email, so there is no self-service reset link. Ask your administrator to set a
          new password for your account. All of your existing sessions are signed out when they do.
        </p>
        <div className="rounded-lg border border-line bg-canvas p-3.5">
          <p className="text-[12.5px] font-medium text-ink">For administrators</p>
          <p className="mt-1 text-[12.5px] text-ink-muted">Run this on the server, from the repository root:</p>
          <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-ink px-3 py-2 font-mono text-[12px] text-white">
            python -m backend.auth.cli reset-password user@example.com
          </code>
        </div>
        <p className="text-[13px] text-ink-muted">If you can still sign in, change your password under Settings → Security.</p>
      </div>
    </AuthLayout>
  );
}

export function Terms() {
  useDocumentTitle('Terms of use and disclaimers');
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-[30px] font-semibold tracking-tight text-ink">Terms of use and disclaimers</h1>
      <p className="mt-2 text-[14px] text-ink-muted">
        Operators who deploy Paheli should review these terms and adapt them to their organisation and jurisdiction.
      </p>
      <div className="mt-8 space-y-7 text-[14.5px] leading-relaxed text-ink-soft">
        <Section title="What Paheli does">
          Paheli analyses the documents and records you add to your workspaces. It builds knowledge graphs, extracts
          figures, structure and provisions, and answers questions with references to the passages it used. It only
          knows what is in your workspace’s sources.
        </Section>
        <Section title="Legal information is not legal advice">
          The Legal &amp; Policy workspace provides legal information and research assistance based only on the sources
          in that workspace. It does not provide legal advice, does not guarantee compliance and does not cover every
          jurisdiction or law. Every law it lists is marked as potentially applicable. Applicability depends on facts
          and on authoritative, current texts that you should confirm with a qualified professional.
        </Section>
        <Section title="Financial analysis is not investment advice or a credit rating">
          Figures are extracted by pattern matching from the documents you upload. They are labelled as reported or
          calculated and carry their source. Risk flags are rule-based prompts for follow-up, not validated scores,
          ratings or recommendations. Check important figures against the audited statements.
        </Section>
        <Section title="Placement and student data">
          Institutions must have the right to process the records they import. Paheli never imports names, contact
          details or sensitive characteristics, even when they are mapped. It does not rank or profile students.
          Student-level records are visible only to workspace members with the analyst or owner role.
        </Section>
        <Section title="Sample data">
          The sample documents and placement records shipped with Paheli are fictional and are labelled as sample
          data wherever they appear. They describe no real company, institution, law or person.
        </Section>
        <Section title="Accounts and security">
          Keep your password private. Sessions use secure, HttpOnly cookies and expire automatically. Workspace owners
          control who can access their workspace and with which role.
        </Section>
        <Section title="No warranty">
          Paheli is provided as is. Automated extraction can be incomplete or wrong. Always review the cited evidence
          before you rely on an answer.
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      <p className="mt-1.5">{children}</p>
    </section>
  );
}

/** The original shared knowledge graph, explorable without an account (read-only unless the policy allows writes). */
export function Demo() {
  useDocumentTitle('Live demo');
  const { status, session } = useAuth();
  const api = useMemo(() => kbApi, []);
  const [params] = useSearchParams();
  const question = params.get('q') ?? undefined;
  const canWrite = !!session?.permissions?.shared_kb_write;
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-ink">
            <Waypoints className="h-5 w-5 text-brand-600" /> Live demo: the shared knowledge graph
          </h1>
          <p className="mt-1 max-w-3xl text-[14px] text-ink-muted">
            Ask questions about the fictional sample documents, inspect entities and relationships, and follow the
            evidence behind every answer.
          </p>
        </div>
        {status !== 'authenticated' && <ButtonLink to="/register">Create your own workspace</ButtonLink>}
      </div>
      <Notice tone="warn" className="mb-4">
        Everything in this demo comes from fictional sample documents. It is shared with every visitor, so don’t add
        confidential material. Your own workspaces are private.
      </Notice>
      <KnowledgeWorkspace key={`shared-demo-${question ?? ''}`} api={api} canWrite={canWrite} canDelete={canWrite} workspaceId={null} initialQuestion={question}
        recordActivity={status === 'authenticated'} className="h-auto lg:h-[calc(100vh-15rem)] lg:min-h-[560px]"
        readOnlyNote={status === 'authenticated'
          ? 'The shared demo graph is read-only for your account. Upload your own documents in one of your workspaces.'
          : 'This demo is read-only. Create an account to upload your own documents into a private workspace. '
            + 'If it is empty, an administrator can load the samples with: python -m backend.kb.cli load-samples'} />
    </div>
  );
}

export function NotFound() {
  useDocumentTitle('Page not found');
  const { status } = useAuth();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-[13px] font-semibold text-brand-700">404</p>
      <h1 className="mt-1 text-[24px] font-semibold text-ink">Page not found</h1>
      <p className="mt-2 max-w-md text-[14px] text-ink-muted">The page you’re looking for doesn’t exist or may have moved.</p>
      <div className="mt-5 flex gap-2">
        <ButtonLink to={status === 'authenticated' ? '/app' : '/'}>{status === 'authenticated' ? 'Go to overview' : 'Go home'}</ButtonLink>
      </div>
    </div>
  );
}
