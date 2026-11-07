import { Button, DropdownMenu, Popover, Select, TextField } from '@radix-ui/themes';
import { useState, type FormEvent } from 'react';
import { statuses, type Job } from '../../shared/workspace';
import { Icon, type IconName } from './Icons';
import { localDate } from './lib/api';
import { activeFilterCount, defaultFilters, locationKeys, rangeActive, scoreActive, sizeBands, type JobFilters } from './lib/job-filters';

type Options = { value: string; label: string }[];
type MultiKey = 'availability' | 'eligibility' | 'locations' | 'companyTypes' | 'sizes' | 'sponsorship' | 'sources' | 'statuses' | 'workplaces';
const options = (values: readonly string[]): Options => values.map(value => ({ value, label: value }));
const companyOptions = options(['Public', 'Private', 'Unknown']);
type Props = {
  jobs: Job[]; filters: JobFilters; onChange: (filters: JobFilters) => void;
  query: string; onQuery: (value: string) => void; saved: boolean; onSaved: () => void;
  sort: string; onSort: (value: string) => void; count: number; timezone: string;
};

export function JobToolbar({ jobs, filters, onChange, query, onQuery, saved, onSaved, sort, onSort, count, timezone }: Props) {
  const [expanded, setExpanded] = useState(false);
  const locations = options([...new Set(jobs.flatMap(locationKeys))].sort());
  const sources = options([...new Set(['LinkedIn', 'Indeed', 'Glassdoor', 'Company sites', ...jobs.map(job => job.source)])]);
  const changeMulti = (key: MultiKey, values: string[]) => onChange({ ...filters, [key]: values });
  const groups: { key: MultiKey; label: string; icon: IconName; options: Options }[] = [
    { key: 'availability', label: 'Listing', icon: 'check', options: [{ value: 'Open', label: 'Open' }, { value: 'Unverified', label: 'Needs checking' }, { value: 'Closed', label: 'Closed' }] },
    { key: 'eligibility', label: 'Eligibility', icon: 'visa', options: [{value:'Qualified',label:'No known restriction'},{value:'Needs review',label:'Authorization needs review'},{value:'Excluded',label:'Does not meet requirements'}] },
    { key: 'statuses', label: 'Application status', icon: 'briefcase', options: options(statuses) },
    { key: 'locations', label: 'Location', icon: 'location', options: locations },
    { key: 'workplaces', label: 'Work setup', icon: 'building', options: options(['Remote', 'Hybrid', 'On-site', 'Unknown']) },
    { key: 'companyTypes', label: 'Company type', icon: 'building', options: companyOptions },
    { key: 'sizes', label: 'Headcount', icon: 'people', options: [...sizeBands.map(({ value, label }) => ({ value, label })), { value: 'Unknown', label: 'Unknown' }] },
    { key: 'sponsorship', label: 'Visa sponsorship', icon: 'visa', options: [{ value: 'Yes', label: 'Sponsors' }, { value: 'No', label: 'Does not sponsor' }, { value: 'Unknown', label: 'Unknown' }] },
    { key: 'sources', label: 'Source', icon: 'globe', options: sources },
  ];
  return <div className="jobs-toolbar">
    <TextField.Root className="job-search" size="2" variant="soft" placeholder="Search jobs…" aria-label="Search jobs" value={query} onChange={event => onQuery(event.target.value)}>
      <TextField.Slot><Icon name="search" size={16} /></TextField.Slot>
      {query && <TextField.Slot><button className="search-clear" aria-label="Clear search" onClick={() => onQuery('')}><Icon name="close" size={14} /></button></TextField.Slot>}
    </TextField.Root>
    <Popover.Root open={expanded} onOpenChange={setExpanded}>
      <Popover.Trigger><Button variant="ghost" color="gray" className={`filter-trigger all-filters-trigger ${activeFilterCount(filters) ? 'is-filtered' : ''}`} aria-label={`All filters, ${activeFilterCount(filters)} active`}><Icon name="filter" size={16} />Filters{activeFilterCount(filters) > 0 && <span className="filter-count">{activeFilterCount(filters)}</span>}</Button></Popover.Trigger>
      <Popover.Content className="all-filters-popover" sideOffset={10} align="start" aria-label="Filter jobs">
        <div className="filter-panel-heading"><strong>Filters</strong><Button variant="ghost" color="gray" size="1" onClick={() => onChange(defaultFilters())}>Reset</Button></div>
        <div className="filter-panel-scroll">
          <div className="filter-groups">{groups.map(group => <div className="filter-field" key={group.key}>
            <span className="filter-field-label"><Icon name={group.icon} size={15} />{group.label}</span>
            <MultiFilter label={group.label} values={filters[group.key]} options={group.options} onChange={values => changeMulti(group.key, values)} />
          </div>)}</div>
          <div className="filter-panel-ranges"><RangeFilter kind="score" filters={filters} onChange={onChange} timezone={timezone} /><RangeFilter kind="dates" filters={filters} onChange={onChange} timezone={timezone} /></div>
        </div>
        <div className="filter-panel-footer"><span>{count} {count === 1 ? 'job' : 'jobs'}</span><Popover.Close><Button size="2">Done</Button></Popover.Close></div>
      </Popover.Content>
    </Popover.Root>
    <button className={`saved-filter ${saved ? 'active' : ''}`} aria-label="Saved jobs only" title="Saved jobs only" aria-pressed={saved} onClick={onSaved}><Icon name="bookmark" size={16} filled={saved} /><span className="sr-only">Saved</span></button>
    <span className="result-count" role="status" aria-live="polite">{count} {count === 1 ? 'job' : 'jobs'}</span>
    <Select.Root size="2" value={sort} onValueChange={onSort}><Select.Trigger variant="ghost" color="gray" className="sort-filter" aria-label="Sort jobs"><Icon name="sort" size={16} /><span>{sort === 'recommended' ? 'Recommended' : sort === 'score' ? 'Best match' : sort === 'posted' ? 'Newest posted' : sort === 'headcount' ? 'Largest company' : 'Newest found'}</span></Select.Trigger><Select.Content position="popper"><Select.Item value="recommended">Recommended</Select.Item><Select.Item value="score">Best match</Select.Item><Select.Item value="posted">Newest posted</Select.Item><Select.Item value="recent">Newest found</Select.Item><Select.Item value="headcount">Largest company</Select.Item></Select.Content></Select.Root>
  </div>;
}

function MultiFilter({ label, values, options, onChange }: { label: string; values: string[]; options: Options; onChange: (values: string[]) => void }) {
  return <DropdownMenu.Root modal={false}><DropdownMenu.Trigger><Button variant="soft" color="gray" className={`filter-trigger ${values.length ? 'is-filtered' : ''}`} aria-label={`${label} filter${values.length ? `, ${values.length} selected` : ''}`}><span className="filter-value">{values.length === 1 ? options.find(option => option.value === values[0])?.label ?? label : values.length ? `${values.length} selected` : 'Any'}</span><DropdownMenu.TriggerIcon /></Button></DropdownMenu.Trigger>
    <DropdownMenu.Content size="2" align="start" className="multi-filter-menu"><DropdownMenu.Label>{label}</DropdownMenu.Label>{label === 'Headcount' && <p className="filter-menu-hint">Reported ranges match overlapping bands.</p>}
      {options.map(option => <DropdownMenu.CheckboxItem key={option.value} checked={values.includes(option.value)} onSelect={event => event.preventDefault()} onCheckedChange={checked => onChange(checked ? [...values, option.value] : values.filter(value => value !== option.value))}>{option.label}</DropdownMenu.CheckboxItem>)}
      <DropdownMenu.Separator /><DropdownMenu.Item disabled={!values.length} onSelect={() => onChange([])}>Clear selection</DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Root>;
}

function RangeFilter({ kind, filters, onChange, timezone }: { kind: 'score' | 'dates'; filters: JobFilters; onChange: (filters: JobFilters) => void; timezone: string }) {
  const [open, setOpen] = useState(false);
  const active = kind === 'score' ? scoreActive(filters) : rangeActive(filters.posted) || rangeActive(filters.found);
  const label = kind === 'score' ? active ? `Fit ${filters.score.min || '0'}–${filters.score.max || '100'}` : 'Fit' : 'Dates';
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger><Button variant="ghost" color="gray" className={`filter-trigger ${active ? 'is-filtered' : ''}`} aria-label={kind === 'score' ? 'Fit score range' : 'Posted and found date ranges'}><Icon name={kind === 'score' ? 'score' : 'calendar'} size={16} />{label}{kind === 'dates' && active && <span className="filter-count">{Number(rangeActive(filters.posted)) + Number(rangeActive(filters.found))}</span>}<Icon name="chevron" size={12} /></Button></Popover.Trigger>
    <Popover.Content className="range-popover" align="start" sideOffset={10} aria-label={kind === 'score' ? 'Fit score range' : 'Date ranges'}>
      {open && <RangeForm kind={kind} filters={filters} timezone={timezone} onApply={next => { onChange(next); setOpen(false); }} />}
    </Popover.Content></Popover.Root>;
}

function RangeForm({ kind, filters, onApply, timezone }: { kind: 'score' | 'dates'; filters: JobFilters; onApply: (next: JobFilters) => void; timezone: string }) {
  const [draft, setDraft] = useState(filters); const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget as HTMLFormElement);
    const value = (name: string) => String(fields.get(name) ?? '');
    const score = { min: value('score-min'), max: value('score-max') };
    const posted = { from: value('posted-from'), to: value('posted-to') };
    const found = { from: value('found-from'), to: value('found-to') };
    if (kind === 'score' && Number(score.min || 0) > Number(score.max || 100)) { setError('Minimum score must be at or below maximum.'); return; }
    if (kind === 'dates' && [posted, found].some(range => range.from && range.to && range.from > range.to)) { setError('Start date must be on or before end date.'); return; }
    onApply(kind === 'score' ? { ...filters, score } : { ...filters, posted, found });
  }
  function recent(days: number) {
    const today = localDate(new Date().toISOString(), timezone);
    const from = new Date(`${today}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - days + 1);
    setDraft({ ...draft, posted: { from: from.toISOString().slice(0, 10), to: today } }); setError('');
  }
  return <form onSubmit={submit}>
    {kind === 'score' ? <><strong>Fit score</strong><div className="range-fields">{(['min', 'max'] as const).map(key => <label key={key}>{key === 'min' ? 'Minimum' : 'Maximum'}<TextField.Root name={`score-${key}`} type="number" inputMode="numeric" min={0} max={100} step={1} placeholder={key === 'min' ? '0' : '100'} value={draft.score[key]} onChange={event => { setDraft({ ...draft, score: { ...draft.score, [key]: event.target.value } }); setError(''); }} /></label>)}</div><div className="range-presets">{[65, 80, 90].map(min => <Button type="button" key={min} size="1" color="gray" variant="soft" onClick={() => { setDraft({ ...draft, score: { min: String(min), max: '' } }); setError(''); }}>{min}+</Button>)}</div></> : <>
      {(['posted', 'found'] as const).map(key => <fieldset className="date-range-group" key={key}><legend>{key === 'posted' ? 'Posted date' : 'Found date'}</legend><div className="range-fields">{(['from', 'to'] as const).map(bound => <label key={bound}>{bound === 'from' ? 'From' : 'Through'}<TextField.Root name={`${key}-${bound}`} aria-label={`${key === 'posted' ? 'Posted' : 'Found'} ${bound === 'from' ? 'from' : 'through'}`} type="date" value={draft[key][bound]} onChange={event => { setDraft({ ...draft, [key]: { ...draft[key], [bound]: event.target.value } }); setError(''); }} /></label>)}</div>{key === 'posted' && <div className="range-presets"><Button type="button" size="1" color="gray" variant="soft" onClick={() => recent(1)}>Today</Button><Button type="button" size="1" color="gray" variant="soft" onClick={() => recent(7)}>Last 7 days</Button><Button type="button" size="1" color="gray" variant="soft" onClick={() => recent(30)}>Last 30 days</Button></div>}</fieldset>)}
      <p className="filter-hint">Inclusive dates · {timezone}. Undated jobs are excluded when a posted range is set.</p>
    </>}
    {kind === 'score' && <p className="filter-hint">Jobs awaiting a new fit assessment are excluded from score ranges.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="range-actions"><Button type="button" variant="ghost" color="gray" onClick={() => onApply(kind === 'score' ? { ...filters, score: { min: '', max: '' } } : { ...filters, posted: { from: '', to: '' }, found: { from: '', to: '' } })}>Clear</Button><Button type="submit">Apply</Button></div>
  </form>;
}
