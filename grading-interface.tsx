import React, { useState, useEffect, useMemo } from 'react';
import { Mic, Square, Settings, Upload, Download, Plus, Trash2, ArrowLeft, ArrowRight, ChevronRight } from 'lucide-react';

// ============================================================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================================================
const CONFIG = {
  // Your Airtable Configuration
  AIRTABLE_API_KEY: 'patCUB0HwqgJr9nOr.615a833b9faf447aab9868f45b8818432dc3337bb8a2a5c1ac01689a92488a3a',
  AIRTABLE_BASE_ID: 'appTwYDVvnYPB8D2N', // e.g., 'appTwYDVvnYPB8D2N'
  
  // Your n8n Webhook URL
  N8N_WEBHOOK_URL: 'https://kringuette0.app.n8n.cloud/webhook-test/voice-grader', // e.g., 'https://your-n8n.com/webhook/grading'
  EXISTING_ASSIGNMENTS_WEBHOOK_URL: 'https://kringuette0.app.n8n.cloud/webhook/431b2dd5-dee4-4390-8f65-39f81b69129c',
  
  // Airtable Table Names (update if your table names are different)
  TABLES: {
    TEACHERS: 'Teachers',
    SECTIONS: 'Master Sections',
    STUDENTS: 'Student Roster',
    GRADES: 'Grades',
    RUBRICS: 'Rubrics',
    VOICE_GRADER: 'Voice Grader'
  },
  
  // Airtable Field Names (update if your field names are different)
  FIELDS: {
    TEACHERS: {
      NAME: 'Name',
      EMAIL: 'Email',
      FIRST_NAME: 'First Name',
      LAST_NAME: 'Last Name',
      SECTIONS: 'Master Sections'
    },
    SECTIONS: {
      NAME: 'Section Name',
      SECTION_ID: 'Section ID',
      TEACHER_LINK: 'Teacher Link',
      STUDENT_ROSTER: 'Student Roster'
    },
    STUDENTS: {
      NAME: 'Name',
      EMAIL: 'Email',
      ID: 'ID',
      SECTIONS: 'Master Sections'
    },
    GRADES: {
      ASSIGNMENT: 'Assignment',
      STUDENT: 'Student',
      COMMENTS: 'Comments',
      FINAL_GRADE: 'Final Grade'
    },

    RUBRICS: {
      NAME: 'Voice Grader',
      TEACHER: 'Teacher (from Voice Grader)',
      ITEMS: 'Rubric Name'
    },

    Voice_Grader: {
      ASSIGNMENT_NAME: 'Assignment Name',
      TEACHER: 'Teacher',
      RUBRIC: 'Rubric',
      SECTIONS: 'Master Sections'
    }
  }
};

const isLikelyJson = (value: string) => {
  const first = value.trim()[0];
  return first === '{' || first === '[';
};

const normalizeRubricItems = (rawItems: any) => {
  if (!rawItems) return [];

  let parsed = rawItems;
  if (typeof rawItems === 'string') {
    const trimmed = rawItems.trim();
    if (!trimmed) return [];
    // If the value looks like JSON, parse it directly. Otherwise try to
    // salvage common patterns (quoted JSON, embedded JSON) before giving up.
    try {
      if (isLikelyJson(trimmed)) {
        parsed = JSON.parse(trimmed);
      } else {
        // Attempt to parse even if the string is wrapped or contains extra
        // human-readable text. This helps when Airtable stores a JSON blob
        // as a quoted string or when someone pasted a rubric name followed
        // by JSON.
        let salvage = trimmed;

        // If wrapped in quotes, unquote and unescape common escapes.
        if ((salvage.startsWith('"') && salvage.endsWith('"')) || (salvage.startsWith("'") && salvage.endsWith("'"))) {
          salvage = salvage.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
        }

        // If there's JSON somewhere inside the string, try to extract from
        // the first '[' or '{' onward.
        const idxBrace = salvage.indexOf('{');
        const idxBracket = salvage.indexOf('[');
        const startIdx = Math.min(idxBrace === -1 ? Infinity : idxBrace, idxBracket === -1 ? Infinity : idxBracket);
        if (startIdx !== Infinity) {
          salvage = salvage.slice(startIdx);
        }

        parsed = JSON.parse(salvage);
      }
    } catch (err) {
      // If salvage failed, surface the raw content (truncated) to help
      // debugging and fall back to an empty rubric so the app continues.
      const shown = (trimmed || '').slice(0, 500);
      console.warn('Unable to parse rubric JSON. Falling back to empty rubric.', err, 'raw:', shown);
      return [];
    }
  }

  if (Array.isArray(parsed)) {
    return parsed
      .map(item => ({
        name: typeof item?.name === 'string' ? item.name : String(item?.name ?? '').trim(),
        maxPoints: typeof item?.maxPoints === 'number' ? item.maxPoints : Number(item?.maxPoints) || 0
      }))
      .filter(item => item.name); // drop blank names
  }

  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) return normalizeRubricItems(parsed.items);
    if (Array.isArray(parsed.rubric)) return normalizeRubricItems(parsed.rubric);
    if (Array.isArray(parsed.data)) return normalizeRubricItems(parsed.data);
  }

  return [];
};

const getRubricSignature = (items: any) => {
  const normalized = normalizeRubricItems(items).map(item => ({
    name: (item.name || '').trim().toLowerCase(),
    maxPoints: Number(item.maxPoints) || 0
  }));
  normalized.sort((a, b) => {
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.maxPoints - b.maxPoints;
  });
  return normalized.map(item => `${item.name}::${item.maxPoints}`).join('|');
};

const getUniqueRubricsByItems = (rubrics = []) => {
  const signatureToIndex = new Map();
  const unique = [];

  rubrics.forEach(rubric => {
    const normalizedItems = normalizeRubricItems(rubric.items);
    if (normalizedItems.length === 0) return; // skip empty/invalid rubrics
    const signature = getRubricSignature(normalizedItems);

    if (!signatureToIndex.has(signature)) {
      signatureToIndex.set(signature, unique.length);
      unique.push({ ...rubric, items: normalizedItems });
    } else {
      const idx = signatureToIndex.get(signature);
      const existing = unique[idx];
      const existingSectionCount = existing.sectionIds?.length || 0;
      const newSectionCount = rubric.sectionIds?.length || 0;
      const shouldReplace = newSectionCount > existingSectionCount || (!existing.assignmentName && rubric.assignmentName);
      if (shouldReplace) {
        unique[idx] = { ...rubric, items: normalizedItems };
      }
    }
  });

  return unique;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function GradingInterface() {
  const [step, setStep] = useState('teacher-select');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  
  // Setup data
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacher, setSelectedTeacher] = useState(null);
  const [sections, setSections] = useState([]);
  const [selectedSections, setSelectedSections] = useState([]);
  const [students, setStudents] = useState([]);
  
  // Assignment setup
  const [assignmentName, setAssignmentName] = useState('');
  const [rubricItems, setRubricItems] = useState([
    { name: 'Correctness', maxPoints: 25 },
    { name: 'Method', maxPoints: 25 },
    { name: 'Clarity', maxPoints: 25 },
    { name: 'Completeness', maxPoints: 25 }
  ]);
  // Saved rubrics UI/state
  const [savedRubrics, setSavedRubrics] = useState([]);
  const [allRubrics, setAllRubrics] = useState([]);
  const [showRubricBrowser, setShowRubricBrowser] = useState(false);
  const [rubricFilterTeacher, setRubricFilterTeacher] = useState(null);
  const [rubricSearchQuery, setRubricSearchQuery] = useState('');
  const [selectedRubricOption, setSelectedRubricOption] = useState('');
  const [assignmentOptions, setAssignmentOptions] = useState([]);
  const [assignmentOptionsLoading, setAssignmentOptionsLoading] = useState(false);
  const [assignmentOptionsError, setAssignmentOptionsError] = useState('');
  
  // Grading data
  const [grades, setGrades] = useState({});
  const [currentStudent, setCurrentStudent] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [processingAudio, setProcessingAudio] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null);
  const [gradeRecordIds, setGradeRecordIds] = useState<Record<string, string>>({});
  const teacherRubricOptions = useMemo(() => {
    // Only show rubrics that belong to the currently selected teacher; do not fall back to all teachers
    const source = selectedTeacher ? savedRubrics : allRubrics;
    return getUniqueRubricsByItems(source || []);
  }, [savedRubrics, allRubrics, selectedTeacher]);

  // Check configuration on mount
  useEffect(() => {
    if (CONFIG.AIRTABLE_API_KEY === 'YOUR_AIRTABLE_API_KEY_HERE') {
      setError('Please configure your Airtable API key in the CONFIG section of the code.');
    }
    if (CONFIG.N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL_HERE') {
      console.warn('n8n webhook URL not configured. Audio processing will not work.');
    }
    loadTeachersFromAirtable();
  }, []);

  // Timer for recording
  useEffect(() => {
    let interval;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      setRecordingTime(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  // Spacebar listener for processing audio chunks
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.code === 'Space' && isRecording && !editingStudent) {
        e.preventDefault();
        processCurrentAudioChunk();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isRecording, editingStudent, audioChunks]);

  // ============================================================================
  // AIRTABLE API FUNCTIONS
  // ============================================================================
  
  const airtableRequest = async (endpoint, options = {}) => {
    const url = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`Airtable API error: ${response.statusText}`);
    }
    
    return response.json();
  };

  const loadTeachersFromAirtable = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await airtableRequest(CONFIG.TABLES.TEACHERS);
      
      const teachersList = data.records.map(record => ({
        id: record.id,
        name: record.fields[CONFIG.FIELDS.TEACHERS.NAME] || 
              `${record.fields[CONFIG.FIELDS.TEACHERS.FIRST_NAME]} ${record.fields[CONFIG.FIELDS.TEACHERS.LAST_NAME]}`,
        email: record.fields[CONFIG.FIELDS.TEACHERS.EMAIL]
      }));
      
      setTeachers(teachersList);
    } catch (err) {
      console.error('Error loading teachers:', err);
      setError('Failed to load teachers from Airtable. Check your configuration and API key.');
    } finally {
      setLoading(false);
    }
  };

  const selectTeacher = async (teacher) => {
    setSelectedTeacher(teacher);
    setSelectedSections([]);
    setActiveAssignmentId(null);
    setLoading(true);
    setStep('class-select');
    setError(null);
    
    try {
      // Filter sections by teacher
      const filterFormula = `SEARCH("${teacher.id}", ARRAYJOIN({${CONFIG.FIELDS.SECTIONS.TEACHER_LINK}}))`;
      const data = await airtableRequest(
        `${CONFIG.TABLES.SECTIONS}?filterByFormula=${encodeURIComponent(filterFormula)}`
      );
      
      const sectionsList = data.records.map(record => ({
        id: record.id,
        name: record.fields[CONFIG.FIELDS.SECTIONS.NAME],
        studentCount: record.fields[CONFIG.FIELDS.SECTIONS.STUDENT_ROSTER]?.length || 0,
        sectionId: record.fields[CONFIG.FIELDS.SECTIONS.SECTION_ID]
      }));
      
      setSections(sectionsList);
    } catch (err) {
      console.error('Error loading sections:', err);
      setError('Failed to load sections. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  // Load saved rubrics when teacher changes
  useEffect(() => {
    if (selectedTeacher) {
      loadSavedRubrics().catch(err => console.error('Error loading rubrics:', err));
      fetchExistingAssignments().catch(err => console.error('Error loading assignments:', err));
    } else {
      setSavedRubrics([]);
      setAllRubrics([]);
      setAssignmentOptions([]);
    }
  }, [selectedTeacher]);

  useEffect(() => {
    setSelectedRubricOption('');
  }, [selectedTeacher]);

  const loadStudentsForSections = async (sectionsToLoad, existingGrades = null) => {
    setLoading(true);
    setError(null);

    try {
      // Fetch section details and collect unique student IDs
      const sectionDetails = await Promise.all(
        sectionsToLoad.map(section => airtableRequest(`${CONFIG.TABLES.SECTIONS}/${section.id}`))
      );

      const uniqueStudentIds = new Set<string>();
      sectionDetails.forEach(detail => {
        const studentIds = detail.fields[CONFIG.FIELDS.SECTIONS.STUDENT_ROSTER] || [];
        studentIds.forEach(id => uniqueStudentIds.add(id));
      });

      if (uniqueStudentIds.size === 0) {
        setError('No students found in the selected section(s)');
        setStudents([]);
        setLoading(false);
        return;
      }

      const studentsData = await Promise.all(
        Array.from(uniqueStudentIds).map(studentId =>
          airtableRequest(`${CONFIG.TABLES.STUDENTS}/${studentId}`)
        )
      );

      const studentsList = studentsData.map(data => ({
        id: data.id,
        name: data.fields[CONFIG.FIELDS.STUDENTS.NAME],
        email: data.fields[CONFIG.FIELDS.STUDENTS.EMAIL],
        studentId: data.fields[CONFIG.FIELDS.STUDENTS.ID]?.toString() || 'N/A'
      }));

      setStudents(studentsList);

      const initialGrades = {} as Record<string, any>;
      const nextGradeRecordIds: Record<string, string> = {};

      studentsList.forEach(student => {
        const existing = existingGrades ? existingGrades[student.id] : null;
        initialGrades[student.id] = {
          scores: existing?.scores || {},
          comments: existing?.comments || '',
          completed: existing?.completed || false
        };
        if (existing?.recordId) {
          nextGradeRecordIds[student.id] = existing.recordId;
        }
      });

      setGradeRecordIds(nextGradeRecordIds);
      setGrades(initialGrades);
    } catch (err) {
      console.error('Error loading students:', err);
      setError('Failed to load students. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const toggleSectionSelection = (section) => {
    setActiveAssignmentId(null);
    setSelectedSections(prev => {
      const exists = prev.find(s => s.id === section.id);
      if (exists) return prev.filter(s => s.id !== section.id);
      return [...prev, section];
    });
  };

  const proceedWithSections = async () => {
    if (selectedSections.length === 0) {
      alert('Please choose at least one section');
      return;
    }

    setStep('setup');
    await loadStudentsForSections(selectedSections);
  };

  // ============================================================================
  // RECORDING AND AUDIO PROCESSING
  // ============================================================================
  
  const startRecording = () => {
    setIsRecording(true);
    setTranscript([]);
    setAudioChunks([]);
    setSessionId(Date.now().toString()); // Generate unique session ID
    // TODO: Initialize MediaRecorder here for real audio capture
  };

  const stopRecording = () => {
    setIsRecording(false);
    setAudioChunks([]);
    setCurrentStudent(null);
    // TODO: Stop MediaRecorder here
  };

  const processCurrentAudioChunk = async () => {
    if (processingAudio) return;
    
    setProcessingAudio(true);
    setTranscript(prev => [...prev, {
      text: '⏳ Processing...',
      timestamp: new Date().toISOString(),
      isProcessing: true
    }]);

    try {
      // TODO: Get actual audio blob from MediaRecorder
      const audioBlob = null; // Replace with actual audio data
      
      if (CONFIG.N8N_WEBHOOK_URL !== 'YOUR_N8N_WEBHOOK_URL_HERE' && audioBlob) {
        // Send to n8n webhook
        const formData = new FormData();
        formData.append('audio', audioBlob);
        formData.append('sessionId', sessionId);
        formData.append('teacherId', selectedTeacher.id);
        formData.append('sectionIds', JSON.stringify(selectedSections.map(s => s.id)));
        formData.append('assignmentName', assignmentName);
        formData.append('rubricItems', JSON.stringify(rubricItems));
        formData.append('students', JSON.stringify(students));
        
        const response = await fetch(CONFIG.N8N_WEBHOOK_URL, {
          method: 'POST',
          body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
          // Update grades with result from n8n
          updateGradesFromN8N(result);
        }
      } else {
        // Fallback: simulate for demo purposes
        console.warn('n8n webhook not configured or no audio. Using simulation.');
        simulateNextStudent();
      }
    } catch (err) {
      console.error('Error processing audio:', err);
      setTranscript(prev => [...prev.filter(t => !t.isProcessing), {
        text: '❌ Error processing audio. Check console.',
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setProcessingAudio(false);
      setTranscript(prev => prev.filter(t => !t.isProcessing));
    }
  };

  const updateGradesFromN8N = (result) => {
    const { studentId, studentName, scores, comments } = result;
    
    setCurrentStudent(studentName);
    setTranscript(prev => [...prev, {
      text: `${studentName}. ${Object.entries(scores).map(([key, val]) => `${key} ${val}`).join(', ')}. ${comments}`,
      timestamp: new Date().toISOString()
    }]);
    
    setGrades(prev => ({
      ...prev,
      [studentId]: {
        scores: scores,
        comments: comments,
        completed: true
      }
    }));
  };

  const simulateNextStudent = () => {
    const ungradedStudents = students.filter(s => !grades[s.id]?.completed);
    
    if (ungradedStudents.length === 0) {
      setTranscript(prev => [...prev, {
        text: '✅ All students graded!',
        timestamp: new Date().toISOString()
      }]);
      return;
    }

    const nextStudent = ungradedStudents[0];
    setCurrentStudent(nextStudent.name);
    
    const baseScores = [23, 22, 24, 21, 20, 25, 19, 23];
    const randomScores = rubricItems.reduce((acc, item, idx) => {
      acc[item.name] = baseScores[idx % baseScores.length];
      return acc;
    }, {});
    
    const comments = [
      'Excellent work showing all steps clearly. Strong understanding of concepts.',
      'Good effort. Need to work on showing more intermediate steps.',
      'Solid performance. Watch for calculation errors in the middle section.',
      'Outstanding analysis. Clear explanation of methodology.',
      'Good work overall. Could improve on organization of solution.'
    ];
    
    setTranscript(prev => [...prev, {
      text: `${nextStudent.name}. ${Object.entries(randomScores).map(([key, val]) => `${key} ${val}`).join(', ')}. ${comments[ungradedStudents.indexOf(nextStudent) % comments.length]}`,
      timestamp: new Date().toISOString()
    }]);
    
    setGrades(prev => ({
      ...prev,
      [nextStudent.id]: {
        scores: randomScores,
        comments: comments[ungradedStudents.indexOf(nextStudent) % comments.length],
        completed: true
      }
    }));
  };

  // ============================================================================
  // SAVE TO AIRTABLE
  // ============================================================================
  
  const saveToAirtable = async () => {
    setLoading(true);

    try {
      // Create records in Grades table for each student
      const gradeEntries = Object.entries(grades)
        .filter(([_, data]) => data.completed)
        .map(([studentId, data]) => {
          const fields = {
            [CONFIG.FIELDS.GRADES.STUDENT]: [studentId],
            [CONFIG.FIELDS.GRADES.COMMENTS]: data.comments,
            [CONFIG.FIELDS.GRADES.FINAL_GRADE]: calculateTotal(data)
          };

          // Add individual rubric scores as fields
          rubricItems.forEach(item => {
            fields[item.name] = data.scores[item.name] || 0;
          });

          const recordId = gradeRecordIds[studentId];
          return recordId ? { id: recordId, fields } : { fields };
        });

      const recordsToUpdate = gradeEntries.filter(entry => (entry as any).id);
      const recordsToCreate = gradeEntries.filter(entry => !(entry as any).id);
      const updatedIds: Record<string, string> = { ...gradeRecordIds };

      if (recordsToUpdate.length > 0) {
        const response = await airtableRequest(CONFIG.TABLES.GRADES, {
          method: 'PATCH',
          body: JSON.stringify({ records: recordsToUpdate })
        });

        response.records.forEach(record => {
          const student = record.fields?.[CONFIG.FIELDS.GRADES.STUDENT]?.[0];
          if (student) {
            updatedIds[student] = record.id;
          }
        });
      }

      if (recordsToCreate.length > 0) {
        const response = await airtableRequest(CONFIG.TABLES.GRADES, {
          method: 'POST',
          body: JSON.stringify({ records: recordsToCreate })
        });

        response.records.forEach(record => {
          const student = record.fields?.[CONFIG.FIELDS.GRADES.STUDENT]?.[0];
          if (student) {
            updatedIds[student] = record.id;
          }
        });
      }

      setGradeRecordIds(updatedIds);
      alert(`Successfully saved ${gradeEntries.length} grades to Airtable!`);

    } catch (err) {
      console.error('Error saving to Airtable:', err);
      alert('Error saving to Airtable. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const fetchGradesByIds = async (gradeIds: string[] = []) => {
    if (!gradeIds || gradeIds.length === 0) return [];

    const chunks: string[][] = [];
    for (let i = 0; i < gradeIds.length; i += 10) {
      chunks.push(gradeIds.slice(i, i + 10));
    }

    const results: any[] = [];
    for (const chunk of chunks) {
      const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      try {
        const response = await airtableRequest(
          `${CONFIG.TABLES.GRADES}?filterByFormula=${encodeURIComponent(formula)}`
        );
        if (Array.isArray(response.records)) {
          results.push(...response.records);
        }
      } catch (err) {
        console.error('Error fetching grade records by id chunk', chunk, err);
      }
    }

    return results;
  };

  const normalizeWebhookAssignments = async (payload) => {
    const listCandidates = Array.isArray(payload?.assignments)
      ? payload.assignments
      : Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

    return Promise.all((listCandidates || []).map(async (entry, idx) => {
      const rubricItems = normalizeRubricItems(
        entry.rubricItems
        ?? entry.rubric
        ?? entry.items
        ?? entry.rubrics
        ?? entry.Rubric
      );
      const sectionIds = (
        entry.sectionIds
        || entry.sections
        || entry.Section
        || entry.section
        || []
      ).filter(Boolean);

      const gradeRecordIds = Array.isArray(entry['Grades 2'])
        ? entry['Grades 2']
        : Array.isArray(entry.grades2)
          ? entry.grades2
          : Array.isArray(entry.Grades)
            ? entry.Grades
            : [];

      let gradeRecords = Array.isArray(entry.grades)
        ? entry.grades
        : Array.isArray(entry.gradeRecords)
          ? entry.gradeRecords
          : [];

      if ((!gradeRecords || gradeRecords.length === 0) && gradeRecordIds.length > 0) {
        gradeRecords = await fetchGradesByIds(gradeRecordIds);
      }

      const gradeMap: Record<string, any> = {};
      gradeRecords.forEach(grade => {
        const fields = grade.fields || grade;
        const studentField = fields[CONFIG.FIELDS.GRADES.STUDENT];
        const studentId = grade.studentId
          || grade.student
          || grade.studentRecordId
          || (Array.isArray(studentField) ? studentField[0] : null);
        if (!studentId) return;

        const scores: Record<string, number> = {};
        rubricItems.forEach(item => {
          const rawScore = fields[item.name];
          if (rawScore !== undefined && rawScore !== null && rawScore !== '') {
            scores[item.name] = Number(rawScore) || 0;
          }
        });

        const comments = fields[CONFIG.FIELDS.GRADES.COMMENTS] || fields.comments || '';
        gradeMap[studentId] = {
          scores,
          comments,
          completed: Object.keys(scores).length > 0 || Boolean(comments),
          recordId: grade.id || grade.recordId
        };
      });

      return {
        id: entry.id || entry.assignmentId || entry.voiceGraderId || entry.rubricRecordId || `assignment-${idx}`,
        name: entry.assignmentName || entry.name || `Assignment ${idx + 1}`,
        assignmentName: entry.assignmentName || entry.name || '',
        rubricItems,
        sectionIds,
        gradeMap,
        voiceGraderId: entry.voiceGraderId || entry.assignmentId || entry.rubricRecordId || null
      };
    });
  };

  const fetchExistingAssignments = async () => {
    if (!selectedTeacher || !CONFIG.EXISTING_ASSIGNMENTS_WEBHOOK_URL) return;

    setAssignmentOptionsLoading(true);
    setAssignmentOptionsError('');

    try {
      const response = await fetch(CONFIG.EXISTING_ASSIGNMENTS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: selectedTeacher.id })
      });

      if (!response.ok) {
        throw new Error(`Webhook request failed: ${response.statusText}`);
      }

      const data = await response.json();
      const normalized = await normalizeWebhookAssignments(data);
      setAssignmentOptions(normalized);
    } catch (err) {
      console.error('Error loading existing assignments:', err);
      setAssignmentOptionsError('Failed to load past assignments.');
      setAssignmentOptions([]);
    } finally {
      setAssignmentOptionsLoading(false);
    }
  };

  const loadSavedRubrics = async () => {
    try {
      // The project stores rubric JSON in the Voice Grader table under the 'Rubric' long-text field.
      const response = await airtableRequest(CONFIG.TABLES.VOICE_GRADER);
      if (!response || !Array.isArray(response.records)) {
        console.warn('Unexpected rubric response shape; skipping rubric load.');
        setAllRubrics([]);
        setSavedRubrics([]);
        return;
      }

      const vgFields = CONFIG.FIELDS.Voice_Grader;
      const allVoiceRubrics = response.records
        .map(record => {
          const rawRubric = record.fields[vgFields.RUBRIC] ?? record.fields[CONFIG.FIELDS.RUBRICS.ITEMS];
          const items = normalizeRubricItems(rawRubric);
          if (!items || items.length === 0) return null; // skip non-JSON or empty rubrics

          const teacherField = record.fields[vgFields.TEACHER] || [];
          const teacherIdsRaw = Array.isArray(teacherField) ? teacherField : [teacherField].filter(Boolean);
          const teacherIds = teacherIdsRaw.filter(id => typeof id === 'string' && id.startsWith('rec'));
          const teacherNamesFromField = teacherIds.length === 0 ? teacherIdsRaw.map(v => String(v)) : [];

          // Also pull any teacher names from linked lookup fields, if present
          const teacherEmails = record.fields['Teacher Email'] || [];
          const teacherNamesExtra = Array.isArray(teacherEmails) ? teacherEmails.map(e => String(e)) : [];

          const sectionFieldCandidates = [
            vgFields.SECTIONS,
            CONFIG.FIELDS.TEACHERS.SECTIONS,
            'Sections',
            'Master Sections',
            'Class Sections'
          ].filter(Boolean);
          const sectionIds = sectionFieldCandidates.reduce((acc, fieldName) => {
            if (acc.length > 0) return acc;
            const val = record.fields[fieldName];
            if (Array.isArray(val)) return val;
            return acc;
          }, [] as string[]);

          return {
            id: record.id,
            name: record.fields[vgFields.ASSIGNMENT_NAME] || record.fields[CONFIG.FIELDS.RUBRICS.NAME] || 'Unnamed',
            assignmentName: record.fields[vgFields.ASSIGNMENT_NAME] || '',
            items,
            teacherIds,
            teacherNames: [...teacherNamesFromField, ...teacherNamesExtra],
            sectionIds
          };
        })
        .filter(Boolean);

      // Optionally fetch teacher names for display (best-effort)
      await Promise.all(allVoiceRubrics.map(async (v) => {
        const names = [...(v.teacherNames || [])];
        for (const tId of v.teacherIds || []) {
          try {
            const td = await airtableRequest(`${CONFIG.TABLES.TEACHERS}/${tId}`);
            const teacherName = td.fields[CONFIG.FIELDS.TEACHERS.NAME];
            if (teacherName) names.push(teacherName);
          } catch (err) {
            console.error('Error loading teacher name for', tId, err);
          }
        }
        v.teacherNames = names;
      }));

      const uniqueVoiceRubrics = getUniqueRubricsByItems(allVoiceRubrics);
      setAllRubrics(uniqueVoiceRubrics);

      const teacherRubrics = selectedTeacher
        ? uniqueVoiceRubrics.filter(rubric => {
            const matchesId = (rubric.teacherIds || []).includes(selectedTeacher.id);
            const matchesName = (rubric.teacherNames || []).some(
              name => typeof name === 'string' && name.toLowerCase() === selectedTeacher.name?.toLowerCase()
            );
            return matchesId || matchesName;
          })
        : uniqueVoiceRubrics;
      setSavedRubrics(getUniqueRubricsByItems(teacherRubrics));
    } catch (err) {
      console.error('Error loading rubrics:', err);
    }
  };



  const openRubricBrowser = () => {
    setShowRubricBrowser(true);
    setRubricFilterTeacher(selectedTeacher);
    setRubricSearchQuery('');
  };

  const loadRubric = (rubric) => {
    const safeItems = Array.isArray(rubric.items) ? rubric.items : normalizeRubricItems(rubric.items);
    setRubricItems(safeItems);
    maybeReuseAssignmentRecord(rubric);
    if (rubric?.id && teacherRubricOptions.some(r => r.id === rubric.id)) {
      setSelectedRubricOption(rubric.id);
    }
    setShowRubricBrowser(false);
  };

  const handleRubricDropdownChange = (rubricId: string) => {
    setSelectedRubricOption(rubricId);
    if (!rubricId) return;
    const selected = teacherRubricOptions.find(r => r.id === rubricId);
    if (selected) {
      loadRubric(selected);
    }
  };

  const applyExistingAssignment = async (assignment) => {
    if (!assignment) return;

    const assignmentLabel = assignment.assignmentName || assignment.name || '';
    setAssignmentName(assignmentLabel);
    if (assignment.rubricItems?.length) {
      setRubricItems(assignment.rubricItems);
    }

    const matchingSections = sections.filter(section => (assignment.sectionIds || []).includes(section.id));
    if (matchingSections.length > 0) {
      setSelectedSections(matchingSections);
      await loadStudentsForSections(matchingSections, assignment.gradeMap || null);
    } else {
      setGradeRecordIds({});
    }

    if (assignment.voiceGraderId || assignment.id) {
      setActiveAssignmentId(assignment.voiceGraderId || assignment.id);
    }
  };

  const normalizeAssignment = (name: string) => (name || '').trim().toLowerCase();

  const sectionsMatch = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const setA = new Set(a);
    return b.every(id => setA.has(id));
  };

  const maybeReuseAssignmentRecord = (rubric) => {
    const currentSections = selectedSections.map(s => s.id);
    const recordSections = Array.isArray(rubric.sectionIds) ? rubric.sectionIds : [];
    const teacherMatches = (rubric.teacherIds || []).includes(selectedTeacher?.id);
    const assignmentMatches = normalizeAssignment(assignmentName) === normalizeAssignment(rubric.assignmentName || rubric.name);

    if (teacherMatches && assignmentMatches && currentSections.length > 0 && sectionsMatch(currentSections, recordSections)) {
      setActiveAssignmentId(rubric.id);
    } else {
      setActiveAssignmentId(null);
    }
  };

  const upsertVoiceGraderRecord = async () => {
    if (!selectedTeacher) return;
    const vgFields = CONFIG.FIELDS.Voice_Grader;
    const sectionFieldName = vgFields.SECTIONS || CONFIG.FIELDS.TEACHERS.SECTIONS || 'Master Sections';
    const fields: Record<string, any> = {
      [vgFields.ASSIGNMENT_NAME]: assignmentName,
      [vgFields.TEACHER]: [selectedTeacher.id],
      [vgFields.RUBRIC]: JSON.stringify(rubricItems),
      [sectionFieldName]: selectedSections.map(s => s.id)
    };

    try {
      if (activeAssignmentId) {
        const updated = await airtableRequest(`${CONFIG.TABLES.VOICE_GRADER}/${activeAssignmentId}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields })
        });
        if (updated?.id) setActiveAssignmentId(updated.id);
      } else {
        const created = await airtableRequest(CONFIG.TABLES.VOICE_GRADER, {
          method: 'POST',
          body: JSON.stringify({ fields })
        });
        if (created?.id) setActiveAssignmentId(created.id);
      }
    } catch (err) {
      console.error('Error syncing Voice Grader record:', err);
    }
  };

  const deleteRubric = async (rubricId, rubricName) => {
    if (!confirm(`Are you sure you want to delete the rubric "${rubricName}"?`)) return;
    try {
      // Delete the Voice Grader record (the modal shows voice-grader entries)
      await airtableRequest(`${CONFIG.TABLES.VOICE_GRADER}/${rubricId}`, { method: 'DELETE' });
      // Optionally also delete associated Rubrics records (left as-is)
      await loadSavedRubrics();
      alert(`Deleted rubric "${rubricName}"`);
    } catch (err) {
      console.error('Error deleting rubric:', err);
      alert(`Failed to delete rubric: ${err.message || err}`);
    }
  };

  const getFilteredRubrics = () => {
    let filtered = allRubrics || [];
    if (rubricFilterTeacher && rubricFilterTeacher.id) {
      filtered = filtered.filter(r => {
        const matchesId = (r.teacherIds || []).includes(rubricFilterTeacher.id);
        const matchesName = (r.teacherNames || []).some(
          name => typeof name === 'string' && name.toLowerCase() === rubricFilterTeacher.name?.toLowerCase()
        );
        return matchesId || matchesName;
      });
    }
    if (rubricSearchQuery && rubricSearchQuery.trim()) {
      const q = rubricSearchQuery.toLowerCase();
      filtered = filtered.filter(r => (r.name || '').toLowerCase().includes(q));
    }
    return filtered;
  };

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================
  
  const addRubricItem = () => {
    setRubricItems([...rubricItems, { name: '', maxPoints: 10 }]);
  };

  const removeRubricItem = (index) => {
    setRubricItems(rubricItems.filter((_, i) => i !== index));
  };

  const updateRubricItem = (index, field, value) => {
    const updated = [...rubricItems];
    updated[index][field] = value;
    setRubricItems(updated);
  };

  const startGrading = async () => {
    if (!assignmentName.trim()) {
      alert('Please enter an assignment name');
      return;
    }
    if (rubricItems.some(item => !item.name.trim())) {
      alert('Please fill in all rubric item names');
      return;
    }
    setLoading(true);
    await upsertVoiceGraderRecord();
    setLoading(false);
    setStep('grading');
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const calculateTotal = (studentGrades) => {
    if (!studentGrades.scores) return 0;
    return Object.values(studentGrades.scores).reduce((sum, score) => sum + (score || 0), 0);
  };

  const calculateMaxTotal = () => {
    return rubricItems.reduce((sum, item) => sum + (item.maxPoints || 0), 0);
  };

  const getInitials = (name) => {
    return name.split(' ').map(n => n[0]).join('');
  };

  const updateScore = (studentId, rubricItem, newScore) => {
    const maxPoints = rubricItems.find(item => item.name === rubricItem)?.maxPoints || 0;
    const validScore = Math.max(0, Math.min(newScore, maxPoints));
    
    setGrades(prev => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        scores: {
          ...prev[studentId].scores,
          [rubricItem]: validScore
        }
      }
    }));
  };

  const updateComments = (studentId, newComments) => {
    setGrades(prev => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        comments: newComments
      }
    }));
  };

  const toggleComplete = (studentId) => {
    setGrades(prev => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        completed: !prev[studentId].completed
      }
    }));
  };

  // ============================================================================
  // RENDER FUNCTIONS
  // ============================================================================

  // Teacher Selection Screen
  if (step === 'teacher-select') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-2xl w-full mx-auto px-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Live Grading Assistant</h1>
            <p className="text-gray-600 mb-6">Select your teacher profile</p>
            
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}
            
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-500 mt-4">Loading teachers...</p>
              </div>
            ) : teachers.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-600">No teachers found. Check your Airtable configuration.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {teachers.map(teacher => (
                  <button
                    key={teacher.id}
                    onClick={() => selectTeacher(teacher)}
                    className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{teacher.name}</p>
                        <p className="text-sm text-gray-500">{teacher.email}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-blue-600" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Class Selection Screen
  if (step === 'class-select') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-2xl w-full mx-auto px-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <button 
              onClick={() => setStep('teacher-select')}
              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-4 text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Teacher Selection
            </button>
            
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Select Your Class</h1>
            <p className="text-gray-600 mb-6">Teacher: {selectedTeacher?.name}</p>
            
            {error && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">{error}</p>
              </div>
            )}
            
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-500 mt-4">Loading sections...</p>
              </div>
            ) : sections.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-600">No sections found for this teacher.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sections.map(section => {
                  const isSelected = selectedSections.some(s => s.id === section.id);
                  return (
                    <button
                      key={section.id}
                      onClick={() => toggleSectionSelection(section)}
                      className={`w-full text-left p-4 border rounded-lg transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">{section.name}</p>
                          <p className="text-sm text-gray-500">{section.studentCount} students</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">Select</span>
                          <input type="checkbox" readOnly checked={isSelected} className="h-4 w-4" />
                        </div>
                      </div>
                    </button>
                  );
                })}
                <button
                  onClick={proceedWithSections}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors mt-2"
                >
                  Continue with {selectedSections.length || 'no'} section{selectedSections.length === 1 ? '' : 's'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Setup Screen
  if (step === 'setup') {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-4xl mx-auto px-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <button 
              onClick={() => setStep('class-select')}
              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-4 text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Class Selection
            </button>
            
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Assignment Setup</h1>
            <p className="text-gray-600 mb-8">
              {selectedTeacher?.name} - {selectedSections.length > 0 ? selectedSections.map(s => s.name).join(', ') : 'No section selected'}
            </p>

            <div className="mb-8">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Continue a previous assignment</p>
                  <p className="text-xs text-gray-600">Load rubric and existing grades from Airtable via the assignment webhook.</p>
                </div>
                <button
                  onClick={fetchExistingAssignments}
                  className="inline-flex items-center gap-1 text-sm text-blue-700 hover:text-blue-800"
                >
                  <Download className="w-4 h-4" /> Refresh list
                </button>
              </div>

              <div className="p-4 border border-indigo-100 rounded-lg bg-indigo-50">
                {assignmentOptionsLoading ? (
                  <div className="flex items-center gap-2 text-indigo-800 text-sm">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                    Loading assignments...
                  </div>
                ) : assignmentOptionsError ? (
                  <p className="text-sm text-red-600">{assignmentOptionsError}</p>
                ) : assignmentOptions.length === 0 ? (
                  <p className="text-sm text-indigo-900">No existing assignments found for this teacher yet.</p>
                ) : (
                  <div className="space-y-3">
                    {assignmentOptions.map(option => (
                      <div key={option.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white border border-indigo-200 rounded-md p-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{option.name || 'Untitled assignment'}</p>
                          <p className="text-xs text-gray-600">
                            {option.rubricItems?.length || 0} rubric item{(option.rubricItems?.length || 0) === 1 ? '' : 's'} • {option.sectionIds?.length || 0} section{(option.sectionIds?.length || 0) === 1 ? '' : 's'}
                          </p>
                        </div>
                        <button
                          onClick={() => applyExistingAssignment(option)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                        >
                          <Upload className="w-4 h-4" /> Load assignment
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mb-8">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Assignment Name
              </label>
              <input
                type="text"
                value={assignmentName}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setAssignmentName(nextValue);
                  if (activeAssignmentId) setActiveAssignmentId(null);
                }}
                placeholder="e.g., Unit 3 Test, Chapter 5 Quiz, Essay Assignment"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="mb-8">
              <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                <label className="block text-sm font-semibold text-gray-900">
                  Rubric Items
                </label>
                <button
                  onClick={addRubricItem}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  Add Item
                </button>
              </div>

              <div className="mb-5">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">
                  Load from past assignments
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={selectedRubricOption}
                    onChange={(e) => handleRubricDropdownChange(e.target.value)}
                    disabled={teacherRubricOptions.length === 0}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="">
                      {teacherRubricOptions.length === 0 ? 'No saved rubrics yet' : 'Choose a saved rubric'}
                    </option>
                    {teacherRubricOptions.map(rubric => (
                      <option key={rubric.id} value={rubric.id}>
                        {rubric.name} • {rubric.items.length} items
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      setShowRubricBrowser(true);
                      setRubricFilterTeacher(selectedTeacher);
                      setRubricSearchQuery('');
                    }}
                    className="px-3 py-2 text-sm text-indigo-700 bg-indigo-100 rounded-lg hover:bg-indigo-200"
                  >
                    Browse All Rubrics
                  </button>
                </div>
                {teacherRubricOptions.length === 0 && (
                  <p className="text-xs text-gray-500 mt-2">
                    Save a rubric after grading to reuse it here automatically.
                  </p>
                )}
              </div>

              <div className="space-y-3">
                {rubricItems.map((item, index) => (
                  <div key={index} className="flex gap-3 items-start">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => updateRubricItem(index, 'name', e.target.value)}
                      placeholder="Item name (e.g., Correctness)"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <input
                      type="number"
                      value={item.maxPoints}
                      onChange={(e) => updateRubricItem(index, 'maxPoints', parseInt(e.target.value) || 0)}
                      placeholder="Points"
                      className="w-24 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      onClick={() => removeRubricItem(index)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                      disabled={rubricItems.length === 1}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                <p className="text-sm font-semibold text-blue-900">
                  Total Points: {calculateMaxTotal()}
                </p>
              </div>
            </div>

            <div className="mb-8">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Student Roster ({students.length} students)
              </label>
              <div className="bg-gray-50 rounded-lg p-4 max-h-48 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2">
                  {students.map(student => (
                    <div key={student.id} className="text-sm text-gray-700">
                      • {student.name}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={startGrading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-2"
            >
              Start Grading Session
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Grading Screen
  // Rubric Browser Modal
  if (showRubricBrowser) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <div className="p-4 flex items-center justify-between border-b">
            <h2 className="text-xl font-semibold">Browse Past Assignments</h2>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search rubrics by name..."
                value={rubricSearchQuery}
                onChange={e => setRubricSearchQuery(e.target.value)}
                className="px-3 py-2 rounded border"
              />
              <select
                value={rubricFilterTeacher?.id || ''}
                onChange={(e) => {
                  if (e.target.value === '') setRubricFilterTeacher(null);
                  else {
                    const t = teachers.find(x => x.id === e.target.value);
                    setRubricFilterTeacher(t || null);
                  }
                }}
                className="px-3 py-2 rounded border"
              >
                <option value="">All Teachers</option>
                {selectedTeacher && <option value={selectedTeacher.id}>My Rubrics ({selectedTeacher.name})</option>}
                {teachers.filter(t => !selectedTeacher || t.id !== selectedTeacher.id).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button onClick={() => setShowRubricBrowser(false)} className="px-3 py-2 bg-gray-100 rounded">Close</button>
            </div>
          </div>

          <div className="p-4 overflow-y-auto">
            {getFilteredRubrics().length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">No rubrics found.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {getFilteredRubrics().map(rubric => {
                  const rubricItemsForDisplay = Array.isArray(rubric.items)
                    ? rubric.items
                    : normalizeRubricItems(rubric.items);

                  return (
                    <div key={rubric.id} className="border rounded p-4 flex flex-col justify-between">
                      <div>
                        <h3 className="font-semibold text-lg">{rubric.name}</h3>
                        <p className="text-sm text-gray-600">By: {rubric.teacherNames.join(', ')}</p>
                        <div className="mt-2 text-sm text-gray-700">
                          {rubricItemsForDisplay.map((it, i) => (
                            <div key={i} className="flex justify-between">
                              <span className="truncate">{it.name}</span>
                              <span className="ml-2">{it.maxPoints}pts</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button onClick={() => loadRubric({ ...rubric, items: rubricItemsForDisplay })} className="px-3 py-2 bg-green-100 rounded">Load</button>
                        {rubric.teacherIds.includes(selectedTeacher?.id) && (
                          <button onClick={() => deleteRubric(rubric.id, rubric.name)} className="px-3 py-2 bg-red-100 rounded">Delete</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{assignmentName}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {selectedTeacher?.name} - {selectedSections.length > 0 ? selectedSections.map(s => s.name).join(', ') : 'No section selected'}
            </p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => setStep('setup')}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Setup
            </button>
            <button 
              onClick={saveToAirtable}
              className="flex items-center gap-2 px-4 py-2 text-white bg-green-600 hover:bg-green-700 rounded-lg"
            >
              <Download className="w-4 h-4" />
              Save to Airtable
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-3 gap-6">
          
          <div className="col-span-1 space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Recording</h2>
              
              <div className="flex flex-col items-center gap-4">
                <button 
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                    isRecording 
                      ? 'bg-red-500 hover:bg-red-600 animate-pulse' 
                      : 'bg-blue-500 hover:bg-blue-600'
                  }`}
                >
                  {isRecording ? (
                    <Square className="w-8 h-8 text-white" />
                  ) : (
                    <Mic className="w-8 h-8 text-white" />
                  )}
                </button>
                
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-900">
                    {isRecording ? 'Recording...' : 'Ready to Record'}
                  </p>
                  <p className="text-2xl font-mono text-gray-600 mt-2">
                    {formatTime(recordingTime)}
                  </p>
                  {currentStudent && (
                    <p className="text-sm text-blue-600 font-medium mt-2">
                      Currently: {currentStudent}
                    </p>
                  )}
                  {processingAudio && (
                    <p className="text-sm text-orange-600 font-medium mt-2 animate-pulse">
                      ⏳ Processing...
                    </p>
                  )}
                </div>
                
                {isRecording && (
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-xs font-semibold text-blue-900 mb-1">How to use:</p>
                    <p className="text-xs text-blue-800">
                      🎤 Speak your assessment for one student<br/>
                      ⌨️ Press <kbd className="px-2 py-0.5 bg-white border border-blue-300 rounded text-blue-900 font-mono">SPACE</kbd> when done<br/>
                      ⏳ Wait 2-3 seconds for AI to process<br/>
                      🔄 Move to next student
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Rubric Reference</h2>
              <div className="space-y-2">
                {rubricItems.map((item, index) => (
                  <div key={index} className="flex justify-between items-center">
                    <span className="text-sm text-gray-700">{item.name}</span>
                    <span className="text-sm font-semibold text-gray-900">/{item.maxPoints}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
                  <span className="text-sm font-semibold text-gray-900">Total</span>
                  <span className="text-sm font-bold text-blue-600">/{calculateMaxTotal()}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Dictation</h2>
              <div className="h-96 overflow-y-auto bg-gray-50 rounded p-4 text-sm text-gray-700 leading-relaxed">
                {transcript.length === 0 ? (
                  <p className="text-gray-400 italic">
                    {isRecording ? 'Speak your assessment, then press SPACEBAR to process...' : 'Start recording to dictate grades'}
                  </p>
                ) : (
                  transcript.map((entry, idx) => (
                    <p key={idx} className={`mb-3 ${entry.isProcessing ? 'text-orange-600 animate-pulse' : ''}`}>
                      {entry.text}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Student Progress ({Object.values(grades).filter(g => g.completed).length}/{students.length})
                </h2>
              </div>

              <div className="space-y-3">
                {students
                  .sort((a, b) => {
                    if (currentStudent === a.name) return -1;
                    if (currentStudent === b.name) return 1;
                    const aCompleted = grades[a.id]?.completed || false;
                    const bCompleted = grades[b.id]?.completed || false;
                    if (aCompleted && !bCompleted) return 1;
                    if (!aCompleted && bCompleted) return -1;
                    return 0;
                  })
                  .map(student => {
                  const studentGrades = grades[student.id] || { scores: {}, comments: '', completed: false };
                  const total = calculateTotal(studentGrades);
                  const colorOptions = ['bg-blue-100 text-blue-600', 'bg-green-100 text-green-600', 'bg-purple-100 text-purple-600', 'bg-orange-100 text-orange-600'];
                  const colorClass = colorOptions[students.indexOf(student) % 4];

                  return (
                    <div 
                      key={student.id} 
                      className={`border rounded-lg p-4 transition-all ${
                        currentStudent === student.name 
                          ? 'border-blue-500 bg-blue-50 shadow-md' 
                          : studentGrades.completed 
                            ? 'border-green-300 bg-green-50'
                            : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${colorClass}`}>
                            {getInitials(student.name)}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{student.name}</p>
                            <p className="text-xs text-gray-500">ID: {student.studentId}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-2xl font-bold ${studentGrades.completed ? 'text-gray-900' : 'text-gray-400'}`}>
                            {studentGrades.completed ? total : '--'}
                          </p>
                          <p className="text-xs text-gray-500">
                            {studentGrades.completed ? `/${calculateMaxTotal()}` : 'Not Graded'}
                          </p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-4 gap-2 mb-3">
                        {rubricItems.map(item => {
                          const isEditing = editingStudent === student.id && editingField === item.name;
                          const score = studentGrades.scores[item.name] || 0;
                          
                          return (
                            <div key={item.name} className="text-center p-2 bg-white rounded border border-gray-200">
                              <p className="text-xs text-gray-600 truncate mb-1">{item.name}</p>
                              {isEditing ? (
                                <input
                                  type="number"
                                  value={score}
                                  onChange={(e) => updateScore(student.id, item.name, parseInt(e.target.value) || 0)}
                                  onBlur={() => {
                                    setEditingStudent(null);
                                    setEditingField(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      setEditingStudent(null);
                                      setEditingField(null);
                                    }
                                  }}
                                  min="0"
                                  max={item.maxPoints}
                                  autoFocus
                                  className="w-full text-lg font-semibold text-center border border-blue-500 rounded px-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : (
                                <p 
                                  onClick={() => {
                                    setEditingStudent(student.id);
                                    setEditingField(item.name);
                                  }}
                                  className={`text-lg font-semibold cursor-pointer hover:bg-blue-50 rounded px-1 ${
                                    studentGrades.completed ? 'text-gray-900' : 'text-gray-400'
                                  }`}
                                  title="Click to edit"
                                >
                                  {score || '--'}
                                </p>
                              )}
                              <p className="text-xs text-gray-500">/ {item.maxPoints}</p>
                            </div>
                          );
                        })}
                      </div>

                      <div className={`${studentGrades.completed ? 'bg-blue-50' : 'bg-gray-50'} rounded p-3`}>
                        <div className="flex items-center justify-between mb-1">
                          <p className={`text-xs font-semibold ${studentGrades.completed ? 'text-blue-900' : 'text-gray-500'}`}>
                            Comments:
                          </p>
                          <button
                            onClick={() => {
                              if (editingStudent === student.id && editingField === 'comments') {
                                setEditingStudent(null);
                                setEditingField(null);
                              } else {
                                setEditingStudent(student.id);
                                setEditingField('comments');
                              }
                            }}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                          >
                            {editingStudent === student.id && editingField === 'comments' ? 'Done' : 'Edit'}
                          </button>
                        </div>
                        {editingStudent === student.id && editingField === 'comments' ? (
                          <textarea
                            value={studentGrades.comments}
                            onChange={(e) => updateComments(student.id, e.target.value)}
                            onBlur={() => {
                              setTimeout(() => {
                                setEditingStudent(null);
                                setEditingField(null);
                              }, 200);
                            }}
                            rows={3}
                            autoFocus
                            className="w-full text-sm p-2 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <p 
                            onClick={() => {
                              setEditingStudent(student.id);
                              setEditingField('comments');
                            }}
                            className="text-sm text-gray-700 cursor-pointer hover:bg-blue-100 rounded p-1"
                            title="Click to edit"
                          >
                            {studentGrades.comments || 'Click to add comments...'}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
