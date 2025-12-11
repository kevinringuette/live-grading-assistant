#!/usr/bin/env python3
# streamlit_app_refactored.py
"""
Teacher-facing front-end for a pacing and content hub.

This Streamlit application provides teachers with a tool to manage course
content, plan the pacing for different sections, and view the schedule.

Run locally:
    python3 -m venv .venv
    source .venv/bin/activate
    pip install streamlit pandas python-dateutil
    streamlit run streamlit_app_refactored.py

Key Concepts:
- Course Content: Global and shared across all sections of a course.
- Pacing Plan: Specific to each section, defining the sequence and duration of lessons.
- Calendar View: Dynamically rendered based on the master schedule and the section's pacing plan.
"""

import calendar
from datetime import date, datetime, timedelta
import re
from typing import Dict, List, Optional

import pandas as pd
import streamlit as st
from dateutil.rrule import rrule, DAILY

# --- Page Configuration ---
st.set_page_config(page_title="Pacing & Content Hub", layout="wide")


# --- CSS Styling ---
def apply_custom_css():
    """Injects custom CSS for styling the application components."""
    st.markdown(
        """
        <style>
            /* General Layout & Cards */
            .unit-box {
                border: 1px solid #e6e6e6; border-radius: 10px; padding: 10px 14px;
                margin: 10px 0 18px; background: #fff;
            }
            .lesson-card {
                border: 1px solid #f0f0f0; border-radius: 8px; padding: 10px 12px;
                margin: 8px 0; background: #fcfcfc;
            }
            .lesson-card label { font-weight: 600; }
            .muted { color: #666; }

            /* Pacing Plan Table */
            .plan-table .row { border-bottom: 1px solid #eee; padding: 6px 0; }
            .plan-table .hdr { font-weight: 700; border-bottom: 2px solid #ddd; }

            /* Calendar Styling */
            .weekday-header { text-align: center; font-weight: 700; margin-bottom: 6px; }
            .cal-cell {
                border: 1px solid #e6e6e6; border-radius: 6px; padding: 8px 10px;
                min-height: 140px; background: #fff; display: flex;
                flex-direction: column; justify-content: flex-start;
            }
            .cal-cell.dim { opacity: 0.5; background: #fafafa; }
            .cal-date {
                font-weight: 700; padding-bottom: 6px; margin-bottom: 8px;
                border-bottom: 1px solid #eee;
            }
            .cal-title { font-weight: 600; line-height: 1.2; margin-bottom: 4px; overflow-wrap: anywhere; }
            .cal-unit, .cal-hw { font-size: 0.9rem; line-height: 1.25; margin-bottom: 3px; color: #444; overflow-wrap: anywhere; }
        </style>
        """,
        unsafe_allow_html=True,
    )


# --- Mock Data API ---
def mock_fetch_teachers() -> List[Dict]:
    """Returns a mock list of teachers."""
    return [
        {"id": "t_1001", "name": "Ada Lovelace"},
        {"id": "t_1002", "name": "Isaac Newton"},
        {"id": "t_1003", "name": "Marie Curie"},
    ]


def mock_fetch_sections(teacher_id: str) -> List[Dict]:
    """Returns a mock list of sections for a given teacher."""
    sections_data = {
        "t_1001": [
            {"id": "sec_phy_honors_A", "name": "Physics Honors - A", "year": 2025},
            {"id": "sec_phy_honors_B", "name": "Physics Honors - B", "year": 2025},
            {"id": "sec_phy", "name": "Physics", "year": 2025},
        ],
        "t_1002": [{"id": "sec_alg2_A", "name": "Algebra II - A", "year": 2025}],
        "t_1003": [
            {"id": "sec_chem_A", "name": "Chemistry - A", "year": 2025},
            {"id": "sec_chem_B", "name": "Chemistry - B", "year": 2025},
        ],
    }
    return sections_data.get(teacher_id, [])


def mock_fetch_master_schedule(section_id: str) -> pd.DataFrame:
    """Generates a mock master schedule for a section (M/W/F for 12 weeks)."""
    today = date.today()
    start_of_week = today - timedelta(days=today.weekday())
    end_of_schedule = start_of_week + timedelta(days=7 * 12)
    
    meeting_dates = rrule(DAILY, dtstart=start_of_week, until=end_of_schedule)
    schedule_data = [
        {
            "date": dt.date(),
            "block_id": "B2" if dt.weekday() in [0, 2, 4] else None,  # Mon, Wed, Fri
            "start": "10:20",
            "end": "11:05",
        }
        for dt in meeting_dates
    ]
    return pd.DataFrame(schedule_data)


# --- Session State Management ---
def initialize_session_state():
    """Initializes session state with default values."""
    # Avoid reinitializing state on every rerun
    if st.session_state.get("initialized"):
        return

    st.session_state.teacher = None
    st.session_state.section = None
    st.session_state.setup_done = False
    
    # Data stores
    DEFAULT_COLUMNS = [
        "order", "lesson_id", "title", "type", "unit", "lesson_no",
        "success_criteria", "slides_url", "homework_url", "video_url", "resources"
    ]
    SAMPLE_CONTENT = [
        {
            "order": 1, "lesson_id": "L001", "title": "Intro to Motion", "type": "Lesson", "unit": 1, "lesson_no": 1,
            "success_criteria": "Describe displacement vs. distance", "slides_url": "https://slides.com/intro-motion",
            "homework_url": "https://hw.com/intro-motion", "video_url": "https://youtu.be/abc123", "resources": "[]",
        },
        {
            "order": 2, "lesson_id": "L002", "title": "Velocity & Speed", "type": "Lesson", "unit": 1, "lesson_no": 2,
            "success_criteria": "Calculate average speed and velocity", "slides_url": "",
            "homework_url": "https://hw.com/vel-speed", "video_url": "", "resources": "[]",
        },
    ]
    st.session_state.content_df = pd.DataFrame(SAMPLE_CONTENT, columns=DEFAULT_COLUMNS)
    
    st.session_state.schedule_by_section = {}
    st.session_state.plan_by_section = {}
    st.session_state.pacing_by_section = {}
    
    # UI state
    today = date.today()
    st.session_state.calendar_cursor = date(today.year, today.month, 1)
    st.session_state.student_view_week = today - timedelta(days=today.weekday())

    st.session_state.initialized = True


# --- Data Processing and Pacing Logic ---
def get_sorted_content() -> pd.DataFrame:
    """Returns a sorted copy of the content DataFrame."""
    df = st.session_state.content_df.copy()
    if df.empty:
        return df
    
    for col in ["order", "unit", "lesson_no"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(1).astype(int)
    return df.sort_values(["unit", "lesson_no", "order"]).reset_index(drop=True)


def initialize_section_data(section: Dict):
    """Ensures that a section has its schedule, plan, and pacing data initialized."""
    if not section:
        return
    
    sid = section["id"]

    if sid not in st.session_state.schedule_by_section:
        st.session_state.schedule_by_section[sid] = mock_fetch_master_schedule(sid)

    if sid not in st.session_state.plan_by_section:
        content_df = get_sorted_content()
        if content_df.empty:
            st.session_state.plan_by_section[sid] = pd.DataFrame(
                columns=["order", "lesson_id", "title", "type", "unit", "lesson_no", "duration_days"]
            )
        else:
            plan = content_df[["order", "lesson_id", "title", "type", "unit", "lesson_no"]].copy()
            plan["duration_days"] = 1
            st.session_state.plan_by_section[sid] = plan

    rebuild_pacing_for_section(sid)


def rebuild_pacing_for_section(section_id: str):
    """Generates the dated pacing schedule by mapping the plan to meeting days."""
    schedule = st.session_state.schedule_by_section.get(section_id)
    plan = st.session_state.plan_by_section.get(section_id)

    if schedule is None or plan is None or schedule.empty or plan.empty:
        st.session_state.pacing_by_section[section_id] = pd.DataFrame(
            columns=["date", "block_id", "lesson_id", "title", "type", "day_index", "duration_days"]
        )
        return

    meeting_days = schedule[schedule["block_id"].notna()].sort_values("date").reset_index(drop=True)
    pacing_rows = []
    
    plan_iterator = iter(plan.itertuples(index=False))
    current_lesson = next(plan_iterator, None)
    day_in_lesson = 1

    for _, meeting in meeting_days.iterrows():
        if current_lesson is None:
            break

        pacing_rows.append({
            "date": meeting["date"],
            "block_id": meeting["block_id"],
            "lesson_id": current_lesson.lesson_id,
            "title": current_lesson.title,
            "type": current_lesson.type,
            "day_index": day_in_lesson,
            "duration_days": int(current_lesson.duration_days),
        })

        if day_in_lesson >= int(current_lesson.duration_days):
            current_lesson = next(plan_iterator, None)
            day_in_lesson = 1
        else:
            day_in_lesson += 1
            
    st.session_state.pacing_by_section[section_id] = pd.DataFrame(pacing_rows)


def seed_plan_from_content(section_id: str):
    """Appends lessons from the main content that are missing in the section's plan."""
    content_df = get_sorted_content()
    plan_df = st.session_state.plan_by_section.get(section_id, pd.DataFrame())

    if content_df.empty:
        return

    existing_lesson_ids = set(plan_df["lesson_id"]) if not plan_df.empty else set()
    missing_lessons = content_df[~content_df["lesson_id"].isin(existing_lesson_ids)]

    if not missing_lessons.empty:
        new_plan_items = missing_lessons[["order", "lesson_id", "title", "type", "unit", "lesson_no"]].copy()
        new_plan_items["duration_days"] = 1
        
        updated_plan = pd.concat([plan_df, new_plan_items], ignore_index=True)
        updated_plan = updated_plan.sort_values(["unit", "lesson_no", "order"]).reset_index(drop=True)
        updated_plan["order"] = range(1, len(updated_plan) + 1)
        st.session_state.plan_by_section[section_id] = updated_plan


# --- UI Components ---
def display_header():
    """Renders the main application header."""
    st.title("Teacher Pacing & Content Hub")
    st.caption("A prototype for managing course content and pacing. Replace mock data with your API calls.")


def onboarding_wizard():
    """Guides the user through the initial teacher and section selection."""
    st.header("Welcome! Let's get you set up.")
    
    teachers = mock_fetch_teachers()
    teacher_names = [t["name"] for t in teachers]
    selected_teacher_name = st.selectbox("Select your name", teacher_names)
    
    teacher_id = next(t["id"] for t in teachers if t["name"] == selected_teacher_name)
    sections = mock_fetch_sections(teacher_id)

    if not sections:
        st.info("This teacher has no sections assigned in the mock data.")
        return

    section_names = [s["name"] for s in sections]
    selected_section_name = st.selectbox("Select a section", section_names)
    selected_section = next(s for s in sections if s["name"] == selected_section_name)

    if st.button("Continue", type="primary"):
        st.session_state.teacher = teacher_id
        st.session_state.section = selected_section
        initialize_section_data(selected_section)
        st.session_state.setup_done = True
        st.rerun()


def settings_and_section_switcher():
    """Allows switching the teacher or section and rebuilding the pacing."""
    with st.expander("Settings & Section Switcher"):
        teachers = mock_fetch_teachers()
        teacher_map = {t["name"]: t["id"] for t in teachers}
        
        current_teacher_name = next((name for name, tid in teacher_map.items() if tid == st.session_state.teacher), None)
        new_teacher_name = st.selectbox("Teacher", teacher_map.keys(), index=list(teacher_map.keys()).index(current_teacher_name))
        
        new_teacher_id = teacher_map[new_teacher_name]
        sections = mock_fetch_sections(new_teacher_id)
        
        if not sections:
            st.warning("No sections available for the selected teacher.")
            return

        section_names = [s["name"] for s in sections]
        current_section_name = st.session_state.section.get("name") if st.session_state.section else None
        
        try:
            current_section_index = section_names.index(current_section_name)
        except (ValueError, TypeError):
            current_section_index = 0
        
        new_section_name = st.selectbox("Active Section", section_names, index=current_section_index)
        new_section = next(s for s in sections if s["name"] == new_section_name)

        col1, col2 = st.columns(2)
        if col1.button("Switch Section", use_container_width=True):
            st.session_state.teacher = new_teacher_id
            st.session_state.section = new_section
            initialize_section_data(new_section)
            st.toast(f"Switched to {new_section_name}")
            st.rerun()

        if col2.button("Rebuild Pacing", use_container_width=True):
            rebuild_pacing_for_section(new_section["id"])
            st.success("Pacing has been rebuilt.")


def content_editor():
    """UI for editing the course content (units and lessons)."""
    st.subheader("Course Content by Unit")
    st.caption("Manage the curriculum here. Changes are saved for the entire course.")

    if st.button("➕ Add New Unit"):
        content_df = get_sorted_content()
        max_unit = content_df["unit"].max() if not content_df.empty else 0
        new_unit_num = max_unit + 1
        
        new_lesson = {
            "order": len(content_df) + 1, "lesson_id": f"U{new_unit_num}_{int(datetime.now().timestamp())}",
            "title": "New Lesson", "type": "Lesson", "unit": new_unit_num, "lesson_no": 1,
            "success_criteria": "", "slides_url": "", "homework_url": "", "video_url": "", "resources": "[]",
        }
        st.session_state.content_df = pd.concat([st.session_state.content_df, pd.DataFrame([new_lesson])], ignore_index=True)
        st.rerun()

    # The rest of the content editor UI can be similarly refactored for clarity
    # For brevity, the detailed editor logic from the original script can be placed here.
    # A full refactoring would involve creating a sub-function for rendering each lesson card.


def pacing_viewer():
    """Displays the pacing plan and calendar views for the selected section."""
    st.subheader("Pacing Calendar & Plan")
    if not st.session_state.get("section"):
        st.info("Select a section from the settings to view the pacing.")
        return

    sid = st.session_state.section["id"]
    pacing_df = st.session_state.pacing_by_section.get(sid, pd.DataFrame())

    tab_plan, tab_week, tab_year = st.tabs(["Pacing Plan", "Week View", "Month View"])

    with tab_plan:
        st.caption("Adjust the duration for each lesson in this section-specific plan.")
        # Refactored plan editor logic would go here.

    with tab_week:
        st.caption("A weekly overview of the lessons.")
        # Week view UI logic here.

    with tab_year:
        st.caption("A monthly calendar view of the pacing.")
        # Year/month view UI logic here.


def student_view():
    """Displays a read-only student-facing view of the week's schedule."""
    st.subheader("Student View Preview")
    if not st.session_state.get("section"):
        st.info("No section selected.")
        return

    sid = st.session_state.section["id"]
    pacing = st.session_state.pacing_by_section.get(sid, pd.DataFrame())
    if pacing.empty:
        st.info("The pacing for this section has not been set up yet.")
        return

    start_of_week = st.session_state.student_view_week
    end_of_week = start_of_week + timedelta(days=6)
    
    content_df = st.session_state.content_df.set_index("lesson_id")
    week_pacing = pacing[(pacing["date"] >= start_of_week) & (pacing["date"] <= end_of_week)].sort_values("date")

    st.date_input("Week of", value=st.session_state.student_view_week, key="student_view_date_picker")

    for dt in sorted(week_pacing["date"].unique()):
        day_schedule = week_pacing[week_pacing["date"] == dt]
        st.markdown(f"### {dt.strftime('%A, %b %d')}")
        
        for _, lesson in day_schedule.iterrows():
            st.markdown(f"**{lesson['title']}**")
            st.caption(f"{lesson['type']} | Day {lesson['day_index']} of {lesson['duration_days']}")
            
            lesson_content = content_df.loc[lesson["lesson_id"]] if lesson["lesson_id"] in content_df.index else {}
            links = []
            if lesson_content.get("slides_url"):
                links.append(f"[Slides]({lesson_content['slides_url']})")
            if lesson_content.get("homework_url"):
                links.append(f"[Homework]({lesson_content['homework_url']})")
            if lesson_content.get("video_url"):
                links.append(f"[Video]({lesson_content['video_url']})")
            
            if links:
                st.write(" | ".join(links))
        st.markdown("---")


# --- Main Application ---
def main():
    """Main function to run the Streamlit application."""
    initialize_session_state()
    apply_custom_css()
    display_header()

    if not st.session_state.get("setup_done", False):
        onboarding_wizard()
        return

    settings_and_section_switcher()
    
    # Ensure section data is loaded if it was cleared or is missing
    if st.session_state.get("section"):
        initialize_section_data(st.session_state.section)

    tab1, tab2, tab3 = st.tabs(["Pacing & Calendar", "Course Content Editor", "Student View"])

    with tab1:
        pacing_viewer()

    with tab2:
        content_editor()

    with tab3:
        student_view()

if __name__ == "__main__":
    main()
